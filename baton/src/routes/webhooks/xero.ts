/**
 * Xero Webhook Route — Baton
 * POST /api/webhooks/xero
 *
 * Xero webhook flow:
 *   1. Intent-to-receive: Xero sends a POST with payload and expects
 *      correct HMAC-SHA256 in response. Must respond within 5 seconds.
 *      If validation fails → 401 (Xero won't retry, subscription stays inactive).
 *      If validation succeeds → 200 (subscription becomes active).
 *   2. Normal webhooks: JSON body with events array, signed via x-xero-signature.
 *
 * See: https://developer.xero.com/documentation/guides/webhooks/overview
 */
import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import { createWebhookHandler } from './handler';
import env from '../../env';
import { logInfo, logWarn, logDebug } from '../../lib/logger';
import * as connectionService from '../../services/connection.service';

const router = Router();

// Cache: tenantId → { orgId, connectionId }
const connectionCache = new Map<string, { orgId: string; connectionId: string; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.use(webhookRateLimiter);

router.post('/', (req: Request, res: Response, next: any) => {
  const rawBody = req.body as Buffer;
  const signature = req.headers['x-xero-signature'] as string | undefined;

  // ─── Intent-to-receive validation ─────────────────────────
  // Xero sends a validation request and checks that we compute
  // the correct HMAC. Body can be empty or minimal.
  // We MUST always respond with the correct status:
  //   - 200 if signature is valid (subscription activates)
  //   - 401 if signature is invalid (subscription stays inactive)
  //
  // For intent-to-receive, Xero sends a payload and signature.
  // We verify it and respond accordingly.
  const bodyStr = rawBody.toString('utf8');
  const isEmptyPayload = !bodyStr || bodyStr === '{}' || bodyStr === '[]';

  if (isEmptyPayload && signature) {
    // Intent-to-receive: verify the HMAC and respond
    const expectedSignature = crypto
      .createHmac('sha256', env.XERO_WEBHOOK_KEY)
      .update(rawBody)
      .digest('base64');

    try {
      const valid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );

      if (valid) {
        logInfo('Xero intent-to-receive validation succeeded');
        res.status(200).send();
      } else {
        logWarn('Xero intent-to-receive validation failed — signature mismatch');
        res.status(401).send();
      }
    } catch {
      logWarn('Xero intent-to-receive validation failed — comparison error');
      res.status(401).send();
    }
    return;
  }

  // ─── Normal webhook ───────────────────────────────────────
  // Delegate to shared handler which does:
  //   verify signature → store → 200 → enqueue SQS
  return createWebhookHandler({
    platform: 'xero',
    getSecret: () => env.XERO_WEBHOOK_KEY,
    resolveConnection: async (payload) => {
      const tenantId = payload.events?.[0]?.tenantId;
      if (!tenantId) return null;

      // Check cache first
      const cached = connectionCache.get(tenantId);
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
        return { orgId: cached.orgId, connectionId: cached.connectionId };
      }

      // Query DynamoDB via accountId-index
      const connection = await connectionService.getConnectionByAccountId(tenantId);
      if (!connection) {
        logWarn('No connection found for Xero tenantId', { tenantId });
        return null;
      }

      connectionCache.set(tenantId, {
        orgId: connection.orgId,
        connectionId: connection.id,
        cachedAt: Date.now(),
      });

      logDebug('Resolved Xero webhook connection', {
        tenantId,
        orgId: connection.orgId,
        connectionId: connection.id,
      });

      return { orgId: connection.orgId, connectionId: connection.id };
    },
  })(req, res, next);
});

export default router;
