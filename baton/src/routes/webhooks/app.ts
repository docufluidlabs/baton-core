/**
 * App Webhook Handler — Baton
 *
 * Handles incoming webhooks for installed catalog apps (no OAuth).
 * Route: POST /api/webhooks/app/:webhookKey
 *
 * Flow:
 * 1. Look up InstalledApp by webhookKey (GSI)
 * 2. Reject inactive apps with 403
 * 3. Decrypt stored secretKeyEnc
 * 4. Read per-platform verification config from AppTemplate catalog
 * 5. Verify HMAC-SHA256 or static token via timingSafeEqual
 * 6. Return 200 immediately
 * 7. Store webhook event (idempotency guard)
 * 8. Update lastWebhookAt + increment webhookCount atomically
 * 9. Enqueue for rule matching via SQS
 */
import * as crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../../db/client';
import { OrgApp, Platform, WebhookProcessingJob } from '../../lib/types';
import { getAppTemplate } from '../../lib/app-catalog';
import { decryptToken } from '../../lib/encryption';
import * as webhookEventService from '../../services/webhook-event.service';
import { sendMessage, QueueNames } from '../../queue/sqs-client';
import { logInfo, logWarn, logError } from '../../lib/logger';
import { headerString, rawBodyOf, parseWebhookBody } from '../../lib/request';
import { redactUrl } from '../../lib/redact';
import { verifyBasicAuth, credentialHeadersOf } from '../../lib/webhook-auth';

const router = Router();

router.post('/:webhookKey', async (req: Request, res: Response, _next: NextFunction) => {
  const { webhookKey } = req.params;

  try {
    // Parse raw body
    const rawBody = rawBodyOf(req);
    const contentType = headerString(req.headers['content-type']).toLowerCase();
    if (!rawBody) {
      logWarn('Webhook body is not raw bytes', { webhookKey, contentType });
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }
    let payload: Record<string, any>;
    try {
      payload = parseWebhookBody(rawBody, contentType);
    } catch {
      logWarn('Invalid webhook body', { webhookKey, contentType });
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    // ─── 1. Look up InstalledApp by webhookKey ────────────
    // Return 404 (not 401) for unknown keys — avoids confirming key existence
    const docClient = getDocClient();
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.ORG_APPS,
      IndexName: 'webhookKey-index',
      KeyConditionExpression: 'webhookKey = :key',
      ExpressionAttributeValues: { ':key': webhookKey },
    }));

    if (!result.Items || result.Items.length === 0) {
      logWarn('App webhook: unknown webhookKey', { webhookKey });
      res.status(404).json({ error: 'Unknown endpoint' });
      return;
    }

    const app = result.Items[0] as OrgApp;
    const { orgId, appSlug } = app;

    // ─── 2. Reject inactive apps ──────────────────────────
    if (app.status !== 'active') {
      logWarn('App webhook: app is inactive', { webhookKey, appSlug, orgId });
      res.status(403).json({ error: 'Platform is inactive' });
      return;
    }

    // ─── 3. Resolve per-platform verification config ──────
    const template = getAppTemplate(appSlug);
    if (!template) {
      logWarn('App webhook: no template found for slug', { appSlug, orgId });
      res.status(500).json({ error: 'App template not found' });
      return;
    }

    const { verificationMethod } = template;

    // ─── 4. Decrypt stored secret key ────────────────────
    if (!app.secretKeyEnc) {
      logWarn('App webhook: no secret configured', { webhookKey, appSlug, orgId });
      res.status(500).json({ error: 'Webhook secret not configured for this platform' });
      return;
    }

    let secretKey: string;
    try {
      secretKey = decryptToken(app.secretKeyEnc);
    } catch {
      logError('App webhook: failed to decrypt secretKeyEnc', new Error('Decryption failed'), { appSlug, orgId });
      res.status(500).json({ error: 'Internal configuration error' });
      return;
    }

    // ─── 5. Verify signature ──────────────────────────────
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, headerString(v)]),
    );

    if (verificationMethod.type === 'hmac_sha256') {
      const sigHeader = headers[verificationMethod.headerName!.toLowerCase()];
      if (!sigHeader) {
        logWarn('App webhook: missing signature header', {
          headerName: verificationMethod.headerName,
          appSlug,
          orgId,
        });
        res.status(401).json({ error: `Missing ${verificationMethod.headerName} header` });
        return;
      }

      // Strip optional prefix (e.g. "sha256=")
      const sigClean = verificationMethod.prefix
        ? sigHeader.replace(verificationMethod.prefix, '')
        : sigHeader;

      const expected = crypto
        .createHmac('sha256', secretKey)
        .update(rawBody)
        .digest(verificationMethod.encoding!);

      let valid = false;
      try {
        valid = crypto.timingSafeEqual(
          Buffer.from(sigClean),
          Buffer.from(expected),
        );
      } catch {
        valid = false; // length mismatch
      }

      if (!valid) {
        logWarn('App webhook: HMAC verification failed', {
          appSlug, orgId,
          sigLen: sigClean.length,
          expectedLen: expected.length,
          sigPreview: sigClean.slice(0, 8) + '...',
          expectedPreview: expected.slice(0, 8) + '...',
          bodyLen: rawBody.length,
          headerName: verificationMethod.headerName,
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

    } else if (verificationMethod.type === 'hmac_hubspot_v3') {
      // HubSpot v3: HMAC-SHA256(clientSecret, "POST" + requestUri + body + timestamp)
      const sigHeader = headers[verificationMethod.headerName!.toLowerCase()];
      if (!sigHeader) {
        logWarn('App webhook: missing HubSpot signature header', { appSlug, orgId });
        res.status(401).json({ error: `Missing ${verificationMethod.headerName} header` });
        return;
      }

      const timestamp = headers['x-hubspot-request-timestamp'] || '';

      // Replay protection: reject webhooks older than 5 minutes
      if (timestamp) {
        const age = Date.now() - parseInt(timestamp, 10);
        if (age > 5 * 60 * 1000) {
          logWarn('App webhook: HubSpot timestamp too old', { appSlug, orgId, age });
          res.status(401).json({ error: 'Webhook timestamp too old' });
          return;
        }
      }

      // Reconstruct the full URL as HubSpot sees it
      const protocol = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
      const host = req.get('x-forwarded-host') || req.get('host') || '';
      const requestUri = decodeURI(`${protocol}://${host}${req.originalUrl}`);

      const sourceString = 'POST' + requestUri + rawBody.toString('utf8') + timestamp;
      const expected = crypto
        .createHmac('sha256', secretKey)
        .update(sourceString, 'utf8')
        .digest('base64');

      let valid = false;
      try {
        valid = crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
      } catch {
        valid = false;
      }

      if (!valid) {
        logWarn('App webhook: HubSpot v3 HMAC verification failed', {
          appSlug, orgId, requestUri: redactUrl(requestUri),
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

    } else if (verificationMethod.type === 'hmac_slack_v0') {
      // Slack: HMAC-SHA256("v0:" + timestamp + ":" + rawBody), signature header prefixed with "v0="
      const sigHeader = headers['x-slack-signature'];
      const timestamp = headers['x-slack-request-timestamp'] || '';

      if (!sigHeader) {
        logWarn('App webhook: missing x-slack-signature header', { appSlug, orgId });
        res.status(401).json({ error: 'Missing x-slack-signature header' });
        return;
      }

      // Slack timestamps are Unix seconds (not ms)
      if (timestamp) {
        const age = Date.now() - parseInt(timestamp, 10) * 1000;
        if (age > 5 * 60 * 1000) {
          logWarn('App webhook: Slack timestamp too old', { appSlug, orgId, age });
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
        logWarn('App webhook: Slack HMAC verification failed', { appSlug, orgId });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

    } else if (verificationMethod.type === 'static_token') {
      const sigHeader = headers[verificationMethod.headerName!.toLowerCase()];
      if (!sigHeader) {
        logWarn('App webhook: missing token header', {
          headerName: verificationMethod.headerName,
          appSlug,
          orgId,
        });
        res.status(401).json({ error: `Missing ${verificationMethod.headerName} header` });
        return;
      }

      let valid = false;
      try {
        const expected = Buffer.from(secretKey);
        const provided = Buffer.from(sigHeader);
        valid = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
      } catch {
        valid = false;
      }

      if (!valid) {
        logWarn('App webhook: token verification failed', { appSlug, orgId });
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

    } else if (verificationMethod.type === 'hmac_bamboohr') {
      // BambooHR: HMAC-SHA256(secret, rawBody + timestamp), output hex
      // Headers: x-bamboohr-timestamp, x-bamboohr-signature
      const sigHeader = headers['x-bamboohr-signature'];
      const timestamp = headers['x-bamboohr-timestamp'] || '';

      if (!sigHeader) {
        logWarn('App webhook: missing x-bamboohr-signature header', { appSlug, orgId });
        res.status(401).json({ error: 'Missing x-bamboohr-signature header' });
        return;
      }
      // The timestamp is part of what BambooHR signs; the per-automation URL
      // has always required it, and the two routes must agree.
      if (!timestamp) {
        logWarn('App webhook: missing x-bamboohr-timestamp header', { appSlug, orgId });
        res.status(401).json({ error: 'Missing x-bamboohr-timestamp header' });
        return;
      }

      const expected = crypto
        .createHmac('sha256', secretKey)
        .update(rawBody.toString('utf8') + timestamp)
        .digest('hex');

      let valid = false;
      try {
        valid = crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
      } catch {
        valid = false;
      }

      if (!valid) {
        logWarn('App webhook: BambooHR HMAC verification failed', { appSlug, orgId });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

    } else if (verificationMethod.type === 'hmac_zendesk') {
      // Zendesk: HMAC-SHA256(secret, timestamp + rawBody), output base64.
      // Headers: x-zendesk-webhook-signature, x-zendesk-webhook-signature-timestamp
      const sigHeader = headers['x-zendesk-webhook-signature'];
      const timestamp = headers['x-zendesk-webhook-signature-timestamp'] || '';

      if (!sigHeader) {
        logWarn('App webhook: missing x-zendesk-webhook-signature header', { appSlug, orgId });
        res.status(401).json({ error: 'Missing x-zendesk-webhook-signature header' });
        return;
      }
      if (!timestamp) {
        logWarn('App webhook: missing x-zendesk-webhook-signature-timestamp header', { appSlug, orgId });
        res.status(401).json({ error: 'Missing x-zendesk-webhook-signature-timestamp header' });
        return;
      }

      // Replay protection: reject webhooks older than 5 minutes (timestamp is ISO-8601)
      const tsMs = Date.parse(timestamp);
      if (!Number.isNaN(tsMs) && Date.now() - tsMs > 5 * 60 * 1000) {
        logWarn('App webhook: Zendesk timestamp too old', { appSlug, orgId, age: Date.now() - tsMs });
        res.status(401).json({ error: 'Webhook timestamp too old' });
        return;
      }

      const expected = crypto
        .createHmac('sha256', secretKey)
        .update(timestamp + rawBody.toString('utf8'))
        .digest('base64');

      let valid = false;
      try {
        valid = crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
      } catch {
        valid = false;
      }

      if (!valid) {
        logWarn('App webhook: Zendesk HMAC verification failed', { appSlug, orgId });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

    } else if (verificationMethod.type === 'basic_auth') {
      const result = verifyBasicAuth(headers['authorization'], secretKey);
      if (!result.ok) {
        if (result.reason === 'misconfigured') {
          logError(
            'App webhook: basic_auth secret not in username:password format',
            new Error('Invalid secret format'),
            { appSlug, orgId },
          );
        } else {
          logWarn('App webhook: Basic Auth verification failed', { appSlug, orgId, reason: result.reason });
        }
        res.status(result.status).json({ error: result.error });
        return;
      }
    } else if (verificationMethod.type !== 'none') {
      // Fail closed: a catalog template naming a method this route does not
      // implement must not be accepted unverified.
      logError('App webhook: unknown verification type — rejecting', new Error('Unknown verificationMethod.type'), {
        appSlug, orgId, type: verificationMethod.type,
      });
      res.status(500).json({ error: 'Unsupported verification method' });
      return;
    }
    // verificationMethod.type === 'none' → no check needed

    // ─── 6. Store webhook event (with idempotency guard) ──
    const event = await webhookEventService.storeWebhookEvent({
      platform: appSlug as Platform,
      connectionId: app.id,
      payload,
      headers,
      credentialHeaders: credentialHeadersOf(verificationMethod),
      signatureValid: true,
    });

    // ─── 7. Return 200 immediately ────────────────────────
    res.status(200).json({ received: true, eventId: event.id });

    // Skip post-processing on duplicate delivery
    if (event.id === 'duplicate') {
      return;
    }

    // ─── 8. Async post-response work ─────────────────────
    setImmediate(async () => { try {
      const now = new Date().toISOString();

      // Update lastWebhookAt + webhookCount atomically
      await docClient.send(new UpdateCommand({
        TableName: TableNames.ORG_APPS,
        Key: { id: app.id },
        UpdateExpression: 'SET lastWebhookAt = :now ADD webhookCount :one',
        ExpressionAttributeValues: { ':now': now, ':one': 1 },
      }));

      // Enqueue for rule matching
      await sendMessage<WebhookProcessingJob>(QueueNames.WEBHOOK_PROCESSING, {
        eventId: event.id,
        platform: appSlug as Platform,
        orgId,
        connectionId: app.id,
        requestId: req.requestId,
      });

      logInfo('App webhook queued', { eventId: event.id, appSlug, orgId });
    } catch (asyncError: any) {
      logError('App webhook post-response error', asyncError, { webhookKey, orgId });
    } });

  } catch (error: any) {
    logError('App webhook handler error', error, { webhookKey });
    if (!res.headersSent) {
      res.status(200).json({ received: true, error: 'Processing error' });
    }
  }
});

export default router;
