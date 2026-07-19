/**
 * Webhook Handler Helper — Baton
 * 
 * Shared logic for all platform webhook routes:
 * 1. Parse raw body
 * 2. Verify signature via connector
 * 3. Store in webhook_events
 * 4. Return 200 immediately (providers enforce short delivery timeouts)
 * 5. Enqueue SQS job for async processing
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { Platform, TriggerPipelineEntry } from '../../lib/types';
import { getConnector, hasConnector } from '../../services/connectors';
import { ExtractedEventInfo } from '../../services/connectors';
import * as webhookEventService from '../../services/webhook-event.service';
import { getDocClient, TableNames } from '../../db/client';
import { sendMessage, QueueNames } from '../../queue/sqs-client';
import { WebhookProcessingJob } from '../../lib/types';
import { logInfo, logError, logWarn } from '../../lib/logger';
import { sendNotification, webhookFailedNotification } from '../../services/notification.service';
import { getOrgAdmins } from '../../services/user.service';

export interface WebhookConnectionContext {
  orgId?: string;
  connectionId?: string;
  /** Per-connection HMAC secret stored on the PlatformConnection (multi-tenant). */
  webhookSecret?: string;
}

export interface WebhookHandlerOptions {
  platform: Platform;
  /**
   * Resolve the secret used for HMAC verification. The resolved connection
   * context (if any) is passed in so platforms can pull a per-connection
   * secret instead of a global env var.
   */
  getSecret: (req: Request, ctx: WebhookConnectionContext | null) => string;
  /** Optional: resolve orgId/connectionId/secret from the payload before verification (sync or async) */
  resolveConnection?: (payload: any) => Promise<WebhookConnectionContext | null> | WebhookConnectionContext | null;
}

/**
 * Create a webhook handler for a specific platform
 * Returns an Express handler that verifies, stores, and queues the webhook
 */
export function createWebhookHandler(options: WebhookHandlerOptions) {
  const { platform, getSecret, resolveConnection } = options;

  return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      // Raw body is available because server.ts uses express.raw() for /api/webhooks
      const rawBody = req.body as Buffer;
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v)])
      );

      // Parse JSON payload
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        logWarn('Invalid JSON in webhook body', { platform });
        res.status(400).json({ error: 'Invalid JSON' });
        return;
      }

      // Resolve org/connection context up front — for multi-tenant platforms
      // the per-connection webhook secret lives on the PlatformConnection, so
      // we need it before signature verification.
      const connectionCtx = resolveConnection ? await resolveConnection(payload) : null;

      // Verify signature — secret must be configured; missing secret is a hard failure
      const secret = getSecret(req, connectionCtx);
      let signatureValid = false;

      if (!secret) {
        logError('Webhook secret not configured — rejecting request', new Error('Missing webhook secret'), { platform });
        res.status(500).json({ error: 'Webhook secret not configured' });
        return;
      } else if (hasConnector(platform)) {
        const connector = getConnector(platform);
        const verification = connector.verifyWebhookSignature(rawBody, headers, secret);
        signatureValid = verification.valid;

        if (!signatureValid) {
          logWarn('Webhook signature verification failed', { platform, reason: verification.reason });
          res.status(401).json({ error: 'Invalid signature' });

          // Best-effort: alert admins of the targeted org. ctx is already
          // resolved above (we needed it for the secret), so we just fan out
          // — no second DDB lookup. If org couldn't be identified, skip.
          setImmediate(async () => {
            try {
              if (!connectionCtx?.orgId) return;
              const admins = await getOrgAdmins(connectionCtx.orgId);
              for (let i = 0; i < admins.length; i++) {
                const notif = webhookFailedNotification(
                  connectionCtx.orgId, admins[i], platform, verification.reason || 'Invalid signature',
                );
                // Slack routes per-org; fan out in-app + email per admin only
                if (i > 0) notif.channels = ['in_app', 'email'];
                await sendNotification(notif);
              }
            } catch (notifErr) {
              logError('Failed to send webhook_failed notification', notifErr, { platform });
            }
          });
          return;
        }
      }

      // Store event (idempotency + audit)
      const event = await webhookEventService.storeWebhookEvent({
        platform,
        connectionId: connectionCtx?.connectionId,
        payload,
        headers,
        signatureValid,
      });

      // Return 200 immediately (don't make the platform wait)
      res.status(200).json({ received: true, eventId: event.id });

      // Duplicate detection (#12): idempotency guard returned a stub — skip all
      // post-processing so we don't create duplicate pipeline entries or SQS messages.
      if (event.id === 'duplicate') {
        logInfo('Duplicate webhook event skipped (idempotency guard)', { platform });
        return;
      }

      // All post-response work runs in a separate async context so that any
      // failure never touches `res` (already sent) — prevents ERR_HTTP_HEADERS_SENT (#02).
      setImmediate(async () => { try {

      // Extract event info for the pipeline entry
      let eventLabel = 'Webhook Event';
      let eventSummary = `${platform} webhook received`;
      let actingUser: string | undefined;

      if (hasConnector(platform)) {
        try {
          const connector = getConnector(platform);
          const info: ExtractedEventInfo = connector.extractEventInfo(payload);
          eventLabel = info.eventLabel || eventLabel;
          eventSummary = info.summary || eventSummary;
          actingUser = info.actingUserEmail;
        } catch (extractErr) {
          logWarn('Event info extraction failed, using defaults', {
            platform,
            eventId: event.id,
            error: (extractErr as Error).message,
          });
        }
      }

      // Truncate rawPayload if it would exceed DynamoDB's 400 KB item limit (#19).
      const rawPayloadJson = JSON.stringify(payload);
      const safeRawPayload: Record<string, any> = rawPayloadJson.length > 50_000
        ? { _truncated: true, size: rawPayloadJson.length, preview: rawPayloadJson.slice(0, 500) }
        : payload;

      // Always create a trigger pipeline entry so it shows in the UI
      const now = new Date().toISOString();
      const inboundEntry: TriggerPipelineEntry = {
        id: uuidv4(),
        orgId: connectionCtx?.orgId || '_unmatched',
        sourcePlatform: platform,
        eventType: 'inbound',
        eventSummary,
        rawPayload: safeRawPayload,
        actionDescription: `Received ${eventLabel} from ${platform}`,
        status: connectionCtx?.orgId ? 'completed' : 'pending',
        attributedTo: actingUser,
        triggeredAt: now,
        completedAt: connectionCtx?.orgId ? now : undefined,
        durationMs: 0,
        attemptNumber: 1,
        userActionable: !connectionCtx?.orgId,
      };

      const docClient = getDocClient();
      await docClient.send(new PutCommand({
        TableName: TableNames.TRIGGER_PIPELINE,
        Item: inboundEntry,
      }));

      // Enqueue for async processing if connection context is available
      if (connectionCtx?.orgId && connectionCtx?.connectionId) {
        await sendMessage<WebhookProcessingJob>(QueueNames.WEBHOOK_PROCESSING, {
          eventId: event.id,
          platform,
          orgId: connectionCtx.orgId,
          connectionId: connectionCtx.connectionId,
          requestId: req.requestId,
        });

        logInfo('Webhook queued for processing', { eventId: event.id, platform });
      } else {
        logWarn('Webhook stored but not queued (no connection context)', { eventId: event.id, platform });
      }

      } catch (asyncError: any) {
        // Post-response failure — log only, never touch `res`
        logError('Webhook post-response processing error', asyncError, { platform, eventId: event.id });
      } }); // end setImmediate

    } catch (error: any) {
      logError('Webhook handler error', error, { platform });
      // Only send error response if we haven't responded yet
      if (!res.headersSent) {
        res.status(200).json({ received: true, error: 'Processing error' });
      }
    }
  };
}
