/**
 * Zoho CRM Webhook Route — Baton
 * POST /api/webhooks/zohocrm
 *
 * Zoho CRM uses notification URLs with a per-connection verification token.
 * The token is set during webhook subscription and Zoho sends it back as the
 * X-Zoho-Token (or X-Zoho-Webhook-Token) header on every delivery.
 *
 * Because we must resolve the connection BEFORE verifying the token
 * (the secret is stored per-connection in DynamoDB), this route uses a
 * standalone handler rather than the generic createWebhookHandler (#04).
 *
 * Payload: { module: "Deals", operation: "insert", ids: ["12345"], org_id: "..." }
 *
 * Resolves connection from org_id in webhook payload via accountId-index.
 */
import * as crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import { getConnector } from '../../services/connectors';
import * as webhookEventService from '../../services/webhook-event.service';
import * as connectionService from '../../services/connection.service';
import { sendMessage, QueueNames } from '../../queue/sqs-client';
import { getDocClient, TableNames } from '../../db/client';
import { TriggerPipelineEntry, WebhookProcessingJob } from '../../lib/types';
import { logInfo, logDebug, logWarn, logError } from '../../lib/logger';

const router = Router();
router.use(webhookRateLimiter);

// Cache: accountIdentifier → { orgId, connectionId, webhookSecret }
const connectionCache = new Map<string, {
  orgId: string;
  connectionId: string;
  webhookSecret: string;
  cachedAt: number;
}>();
const CACHE_TTL = 5 * 60 * 1000;

router.post('/', async (req: Request, res: Response) => {
  try {
    const rawBody = req.body as Buffer;
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
    );

    // Parse JSON payload
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      logWarn('Invalid JSON in Zoho CRM webhook body');
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    // Resolve connection first (we need the stored secret before we can verify)
    const accountIdentifier = payload.org_id?.toString() || payload.token?.toString();
    if (!accountIdentifier) {
      logWarn('Zoho CRM webhook missing org_id and token fields', { payload });
      res.status(400).json({ error: 'Missing org_id' });
      return;
    }

    // Check cache
    const cached = connectionCache.get(accountIdentifier);
    let orgId: string;
    let connectionId: string;
    let webhookSecret: string;

    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      ({ orgId, connectionId, webhookSecret } = cached);
    } else {
      const connection = await connectionService.getConnectionByAccountId(accountIdentifier);
      if (!connection) {
        logWarn('No connection found for Zoho CRM account identifier', { accountIdentifier });
        // Return 200 to prevent Zoho from disabling the webhook subscription
        res.status(200).json({ received: true });
        return;
      }
      orgId = connection.orgId;
      connectionId = connection.id;
      webhookSecret = connection.webhookSecret || '';
      connectionCache.set(accountIdentifier, { orgId, connectionId, webhookSecret, cachedAt: Date.now() });
    }

    // Verify X-Zoho-Token against the per-connection stored secret (#04)
    const connector = getConnector('zohocrm');
    const verification = connector.verifyWebhookSignature(rawBody, headers, webhookSecret);

    if (!verification.valid) {
      logWarn('Zoho CRM webhook signature verification failed', {
        reason: verification.reason,
        accountIdentifier,
      });
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    // Store event with idempotency
    const event = await webhookEventService.storeWebhookEvent({
      platform: 'zohocrm',
      connectionId,
      payload,
      headers,
      signatureValid: true,
    });

    // Return 200 immediately
    res.status(200).json({ received: true, eventId: event.id });

    // Skip post-processing on duplicate delivery (#12)
    if (event.id === 'duplicate') {
      return;
    }

    // Post-response async work
    setImmediate(async () => { try {
      const connector2 = getConnector('zohocrm');
      const info = connector2.extractEventInfo(payload);
      const now = new Date().toISOString();

      const rawPayloadJson = JSON.stringify(payload);
      const safeRawPayload = rawPayloadJson.length > 50_000
        ? { _truncated: true, size: rawPayloadJson.length, preview: rawPayloadJson.slice(0, 500) }
        : payload;

      const pipelineEntry: TriggerPipelineEntry = {
        id: uuidv4(),
        orgId,
        sourcePlatform: 'zohocrm',
        eventType: 'inbound',
        eventSummary: info.summary || `Zoho CRM ${info.eventLabel} received`,
        rawPayload: safeRawPayload,
        actionDescription: `Received ${info.eventLabel} from Zoho CRM`,
        status: 'completed',
        attributedTo: info.actingUserEmail,
        triggeredAt: now,
        completedAt: now,
        durationMs: 0,
        attemptNumber: 1,
        userActionable: false,
      };

      const docClient = getDocClient();
      await docClient.send(new PutCommand({
        TableName: TableNames.TRIGGER_PIPELINE,
        Item: pipelineEntry,
      }));

      await sendMessage<WebhookProcessingJob>(QueueNames.WEBHOOK_PROCESSING, {
        eventId: event.id,
        platform: 'zohocrm',
        orgId,
        connectionId,
        requestId: req.requestId,
      });

      logInfo('Zoho CRM webhook queued for processing', { eventId: event.id, orgId, accountIdentifier });
      logDebug('Resolved Zoho CRM webhook connection', { accountIdentifier, orgId, connectionId });
    } catch (asyncError: any) {
      logError('Zoho CRM post-response processing error', asyncError, { accountIdentifier });
    } });

  } catch (error: any) {
    logError('Zoho CRM webhook handler error', error);
    if (!res.headersSent) {
      res.status(200).json({ received: true, error: 'Processing error' });
    }
  }
});

export default router;
