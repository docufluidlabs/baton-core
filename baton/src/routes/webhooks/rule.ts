/**
 * Per-Automation Webhook Handler — Baton
 *
 * Handles incoming webhooks routed to a specific automation rule.
 * Route: POST /api/webhooks/rule/:webhookKey
 *
 * Flow:
 * 1. Look up AutomationRule by webhookKey (scan — low volume)
 * 2. Reject inactive/disabled rules
 * 3. Find the associated OrgApp to get the secret for verification
 * 4. Verify signature using the platform's verification method
 * 5. Return 200 immediately
 * 6. Store webhook event + enqueue for processing (only this rule)
 */
import * as crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../../db/client';
import { AutomationRule, OrgApp, Platform, WebhookProcessingJob } from '../../lib/types';
import { getAppTemplate } from '../../lib/app-catalog';
import { decryptToken } from '../../lib/encryption';
import { resolveSfRegistration, sfRegKey } from '../../lib/sf-registration-key';
import * as webhookEventService from '../../services/webhook-event.service';
import { sendMessage, QueueNames } from '../../queue/sqs-client';
import { logInfo, logWarn, logError } from '../../lib/logger';

const router = Router();

router.post('/:webhookKey', async (req: Request, res: Response, _next: NextFunction) => {
  const webhookKey = req.params.webhookKey as string;
  // Correlation id sent by SF Apex (v0.6.0-2+). Same UUID as the payload's eventId.
  // Stamped on every log in this request and forwarded to the workflow worker so
  // one grep follows a record from Apex Job → Datadog → Maestro instance.
  const sfDispatchId = typeof req.headers['x-baton-dispatch-id'] === 'string'
    ? (req.headers['x-baton-dispatch-id'] as string)
    : undefined;

  try {
    // Parse raw body
    const rawBody = req.body as Buffer;
    let payload: Record<string, any>;
    const bodyStr = rawBody.toString('utf8');
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    try {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        payload = Object.fromEntries(new URLSearchParams(bodyStr));
      } else {
        payload = JSON.parse(bodyStr);
      }
    } catch {
      logWarn('Invalid webhook body', { webhookKey, contentType, sfDispatchId });
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    // ─── 1. Look up AutomationRule by webhookKey ──────────
    const docClient = getDocClient();
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.AUTOMATION_RULES,
      IndexName: 'webhookKey-index',
      KeyConditionExpression: 'webhookKey = :key',
      ExpressionAttributeValues: { ':key': webhookKey },
    }));

    if (!result.Items || result.Items.length === 0) {
      logWarn('Rule webhook: unknown webhookKey', { webhookKey, sfDispatchId });
      res.status(404).json({ error: 'Unknown endpoint' });
      return;
    }

    const rule = result.Items[0] as AutomationRule;
    const { orgId, sourcePlatform, appSlug, appId } = rule;

    // ─── 2. Reject disabled/error rules; allow paused (webhooks get queued) ──
    if (rule.status === 'disabled' || rule.status === 'error') {
      logWarn('Rule webhook: automation is disabled/error', { webhookKey, ruleId: rule.id, status: rule.status, sfDispatchId });
      res.status(403).json({ error: 'Automation is not active' });
      return;
    }

    // ─── 3. Find the OrgApp for signature verification ─────
    // The rule is linked to an installed platform via appId or appSlug
    let app: OrgApp | undefined;

    if (appId) {
      // ConsistentRead guarantees we see the latest sfRegistrations after a
      // just-completed registration callout — the second callout (webhook
      // delivery) arrives ~5ms after registration's UpdateItem, which is
      // faster than DDB's default eventually-consistent read replication.
      const appResult = await docClient.send(new GetCommand({
        TableName: TableNames.ORG_APPS,
        Key: { id: appId },
        ConsistentRead: true,
      }));
      app = appResult.Item as OrgApp | undefined;
    }

    if (!app && appSlug) {
      // Fallback: find active OrgApp by slug + org. GSI queries don't support
      // ConsistentRead but this path is unlikely to race with registrations.
      const appResult = await docClient.send(new QueryCommand({
        TableName: TableNames.ORG_APPS,
        IndexName: 'orgId-index',
        KeyConditionExpression: 'orgId = :orgId',
        FilterExpression: 'appSlug = :slug AND #st = :active',
        ExpressionAttributeValues: { ':orgId': orgId, ':slug': appSlug, ':active': 'active' },
        ExpressionAttributeNames: { '#st': 'status' },
      }));
      app = (appResult.Items?.[0] as OrgApp) || undefined;
    }

    if (!app) {
      logWarn('Rule webhook: no installed platform found for rule', { ruleId: rule.id, appSlug, orgId, sfDispatchId });
      res.status(500).json({ error: 'Platform not configured' });
      return;
    }

    // ─── 4. Resolve template + verify signature ────────────
    const template = getAppTemplate(app.appSlug);
    if (!template) {
      logWarn('Rule webhook: no template found for slug', { appSlug: app.appSlug, orgId, sfDispatchId });
      res.status(500).json({ error: 'App template not found' });
      return;
    }

    const { verificationMethod } = template;

    // Header normalization moved up — we need it for sfOrgId lookup before
    // resolving which secret to verify against.
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
    );

    // ─── Resolve which secret to verify with ───────────────
    // Multi-tenant precedence:
    //   1. If `X-Baton-Sf-Org-Id` header present → per-(SF-org, webhook)
    //      secret from sfRegistrations: composite `<sfOrgId>#<webhookKey>`
    //      entry first (per-rule, current keying), then legacy bare
    //      `<sfOrgId>` entry (pre-composite, shared app-wide). Do NOT fall
    //      back to the app-level legacy secret on miss — a missing entry must
    //      return 401 so the Apex managed package's auto-heal path
    //      (BatonDispatcher: re-register via ?bootstrap=) triggers.
    //   2. Else fall back to the legacy single OrgApp.secretKeyEnc field
    //      (v0.1–v0.3.0-1 Salesforce, plus all other platforms).
    const sfOrgIdHeader = headers['x-baton-sf-org-id'];
    let secretEncToVerify: string | undefined;
    let secretSource: string;
    if (sfOrgIdHeader) {
      const resolved = resolveSfRegistration(app, sfOrgIdHeader, webhookKey);
      secretEncToVerify = resolved?.entry.secretKeyEnc;
      secretSource = resolved
        ? `sfRegistrations[${resolved.key}]${resolved.isLegacy ? ' (legacy per-org)' : ''}`
        : `sfRegistrations[${sfRegKey(sfOrgIdHeader, webhookKey)}] (missing)`;
      if (!secretEncToVerify) {
        logWarn('Rule webhook: SF org has no registration for this webhook (likely rotated or never registered)', {
          appSlug: app.appSlug, orgId, sfOrgIdHeader, sfDispatchId,
          lookupKey: sfRegKey(sfOrgIdHeader, webhookKey),
          availableRegistrations: Object.keys(app.sfRegistrations || {}),
        });
        res.status(401).json({ error: 'Salesforce org not registered' });
        return;
      }
    } else {
      secretEncToVerify = app.secretKeyEnc;
      secretSource = 'legacy';
    }

    if (!secretEncToVerify) {
      logWarn('Rule webhook: no secret configured', { appSlug: app.appSlug, orgId, sfOrgIdHeader, sfDispatchId });
      res.status(500).json({ error: 'Webhook secret not configured' });
      return;
    }

    let secretKey: string;
    try {
      secretKey = decryptToken(secretEncToVerify);
    } catch {
      logError('Rule webhook: failed to decrypt secret', new Error('Decryption failed'), {
        appSlug: app.appSlug, orgId, secretSource, sfDispatchId,
      });
      res.status(500).json({ error: 'Internal configuration error' });
      return;
    }

    // Debug visibility for HMAC failures: log which secret was picked, the
    // available registrations, and the header value seen on this request.
    logInfo('Rule webhook: secret resolved for HMAC verification', {
      ruleId: rule.id,
      appSlug: app.appSlug,
      sfOrgIdHeader,
      sfDispatchId,
      secretSource,
      sfRegistrationKeys: Object.keys(app.sfRegistrations || {}),
      hasLegacySecret: !!app.secretKeyEnc,
    });
    if (verificationMethod.type === 'hmac_sha256') {
      const sigHeader = headers[verificationMethod.headerName!.toLowerCase()];
      if (!sigHeader) {
        res.status(401).json({ error: `Missing ${verificationMethod.headerName} header` });
        return;
      }
      const sigClean = verificationMethod.prefix
        ? sigHeader.replace(verificationMethod.prefix, '')
        : sigHeader;
      const expected = crypto
        .createHmac('sha256', secretKey)
        .update(rawBody)
        .digest(verificationMethod.encoding!);

      let valid = false;
      try { valid = crypto.timingSafeEqual(Buffer.from(sigClean), Buffer.from(expected)); }
      catch { valid = false; }

      if (!valid) {
        logWarn('Rule webhook: HMAC verification failed', {
          ruleId: rule.id,
          appSlug: app.appSlug,
          orgId,
          secretSource,
          sfDispatchId,
          sigHeaderPrefix: sigHeader.substring(0, 12) + '...',
          expectedPrefix: expected.substring(0, 12) + '...',
          bodyByteLength: rawBody.length,
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else if (verificationMethod.type === 'hmac_hubspot_v3') {
      const sigHeader = headers[verificationMethod.headerName!.toLowerCase()];
      if (!sigHeader) {
        res.status(401).json({ error: `Missing ${verificationMethod.headerName} header` });
        return;
      }
      const timestamp = headers['x-hubspot-request-timestamp'] || '';
      if (timestamp) {
        const age = Date.now() - parseInt(timestamp, 10);
        if (age > 5 * 60 * 1000) {
          res.status(401).json({ error: 'Webhook timestamp too old' });
          return;
        }
      }
      const protocol = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
      const host = req.get('x-forwarded-host') || req.get('host') || '';
      const requestUri = decodeURI(`${protocol}://${host}${req.originalUrl}`);
      const sourceString = 'POST' + requestUri + rawBody.toString('utf8') + timestamp;
      const expected = crypto.createHmac('sha256', secretKey).update(sourceString, 'utf8').digest('base64');

      logWarn('HubSpot v3 signature debug', {
        requestUri,
        timestamp,
        sigHeader,
        expected,
        sourceStringPreview: sourceString.slice(0, 120),
      });

      let valid = false;
      try { valid = crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected)); }
      catch { valid = false; }

      if (!valid) {
        logWarn('Rule webhook: HubSpot v3 HMAC verification failed', { ruleId: rule.id, appSlug: app.appSlug, orgId, requestUri, sigHeader, expected });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else if (verificationMethod.type === 'hmac_slack_v0') {
      // Slack: HMAC-SHA256("v0:" + timestamp + ":" + rawBody), signature header prefixed with "v0="
      const sigHeader = headers['x-slack-signature'];
      const timestamp = headers['x-slack-request-timestamp'] || '';

      if (!sigHeader) {
        res.status(401).json({ error: 'Missing x-slack-signature header' });
        return;
      }

      // Slack timestamps are Unix seconds (not ms)
      if (timestamp) {
        const age = Date.now() - parseInt(timestamp, 10) * 1000;
        if (age > 5 * 60 * 1000) {
          res.status(401).json({ error: 'Webhook timestamp too old' });
          return;
        }
      }

      const baseString = `v0:${timestamp}:${rawBody.toString('utf8')}`;
      const expected = 'v0=' + crypto.createHmac('sha256', secretKey).update(baseString, 'utf8').digest('hex');

      let valid = false;
      try { valid = crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected)); }
      catch { valid = false; }

      if (!valid) {
        logWarn('Rule webhook: Slack HMAC verification failed', { ruleId: rule.id, appSlug: app.appSlug, orgId });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else if (verificationMethod.type === 'hmac_bamboohr') {
      // BambooHR: HMAC-SHA256(rawBody + timestamp), hex, header `x-bamboohr-signature`,
      // timestamp in `x-bamboohr-timestamp` (Unix seconds).
      const sigHeader = headers['x-bamboohr-signature'];
      const timestamp = headers['x-bamboohr-timestamp'] || '';
      if (!sigHeader || !timestamp) {
        res.status(401).json({ error: 'Missing BambooHR signature headers' });
        return;
      }
      const expected = crypto
        .createHmac('sha256', secretKey)
        .update(rawBody.toString('utf8') + timestamp)
        .digest('hex');

      let valid = false;
      try { valid = crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected)); }
      catch { valid = false; }

      if (!valid) {
        logWarn('Rule webhook: BambooHR HMAC verification failed', {
          ruleId: rule.id,
          appSlug: app.appSlug,
          orgId,
          secretSource,
          sigHeaderPrefix: sigHeader.substring(0, 12) + '...',
          expectedPrefix: expected.substring(0, 12) + '...',
          bodyByteLength: rawBody.length,
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else if (verificationMethod.type === 'hmac_zendesk') {
      // Zendesk: HMAC-SHA256(secret, timestamp + rawBody), base64.
      // Headers: x-zendesk-webhook-signature, x-zendesk-webhook-signature-timestamp (ISO-8601, also signed).
      const sigHeader = headers['x-zendesk-webhook-signature'];
      const timestamp = headers['x-zendesk-webhook-signature-timestamp'] || '';
      if (!sigHeader || !timestamp) {
        res.status(401).json({ error: 'Missing Zendesk signature headers' });
        return;
      }

      // Replay protection: reject webhooks older than 5 minutes
      const tsMs = Date.parse(timestamp);
      if (!Number.isNaN(tsMs) && Date.now() - tsMs > 5 * 60 * 1000) {
        res.status(401).json({ error: 'Webhook timestamp too old' });
        return;
      }

      const expected = crypto
        .createHmac('sha256', secretKey)
        .update(timestamp + rawBody.toString('utf8'))
        .digest('base64');

      let valid = false;
      try { valid = crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected)); }
      catch { valid = false; }

      if (!valid) {
        logWarn('Rule webhook: Zendesk HMAC verification failed', {
          ruleId: rule.id,
          appSlug: app.appSlug,
          orgId,
          secretSource,
          sigHeaderPrefix: sigHeader.substring(0, 12) + '...',
          expectedPrefix: expected.substring(0, 12) + '...',
          bodyByteLength: rawBody.length,
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else if (verificationMethod.type === 'static_token') {
      const sigHeader = headers[verificationMethod.headerName!.toLowerCase()];
      if (!sigHeader) {
        res.status(401).json({ error: `Missing ${verificationMethod.headerName} header` });
        return;
      }
      let valid = false;
      try {
        const exp = Buffer.from(secretKey);
        const prov = Buffer.from(sigHeader);
        valid = exp.length === prov.length && crypto.timingSafeEqual(exp, prov);
      } catch { valid = false; }

      if (!valid) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
    } else if (verificationMethod.type !== 'none' && verificationMethod.type !== 'basic_auth') {
      // Fail-closed for any unrecognized verification type so a new template
      // can't silently bypass HMAC like `hmac_bamboohr` did before this fix.
      logError('Rule webhook: unknown verification type — rejecting', new Error('Unknown verificationMethod.type'), {
        ruleId: rule.id, appSlug: app.appSlug, orgId, type: verificationMethod.type,
      });
      res.status(500).json({ error: 'Unsupported verification method' });
      return;
    }
    // verificationMethod.type === 'none' / 'basic_auth' → no check needed here

    // ─── 5. Store webhook event ────────────────────────────
    const event = await webhookEventService.storeWebhookEvent({
      platform: sourcePlatform as Platform,
      connectionId: app.id,
      payload,
      headers,
      signatureValid: true,
    });

    // ─── 6. Return 200 immediately ────────────────────────
    res.status(200).json({ received: true, eventId: event.id });

    if (event.id === 'duplicate') return;

    // ─── 7. Async post-response work ──────────────────────
    setImmediate(async () => { try {
      const now = new Date().toISOString();

      // Update OrgApp stats
      await docClient.send(new UpdateCommand({
        TableName: TableNames.ORG_APPS,
        Key: { id: app!.id },
        UpdateExpression: 'SET lastWebhookAt = :now ADD webhookCount :one',
        ExpressionAttributeValues: { ':now': now, ':one': 1 },
      }));

      // Enqueue for processing — the rule ID is passed so the processor
      // can skip broad rule matching and process only this specific rule
      await sendMessage<WebhookProcessingJob>(QueueNames.WEBHOOK_PROCESSING, {
        eventId: event.id,
        platform: sourcePlatform as Platform,
        orgId,
        connectionId: app!.id,
        requestId: req.requestId,
        ruleId: rule.id,
        sfDispatchId,
      });

      logInfo('Rule webhook queued', { eventId: event.id, ruleId: rule.id, appSlug: app!.appSlug, orgId, sfDispatchId });
    } catch (asyncError: any) {
      logError('Rule webhook post-response error', asyncError, { webhookKey, orgId, sfDispatchId });
    } });

  } catch (error: any) {
    logError('Rule webhook handler error', error, { webhookKey, sfDispatchId });
    if (!res.headersSent) {
      res.status(200).json({ received: true, error: 'Processing error' });
    }
  }
});

export default router;
