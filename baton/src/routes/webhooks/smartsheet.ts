/**
 * Smartsheet Webhook Route — Baton
 * POST /api/webhooks/smartsheet
 *
 * Smartsheet uses a two-phase webhook pattern:
 *   1. Verification challenge: Smartsheet sends { challenge: "..." }
 *      We must respond with { smartsheetHookResponse: HMAC-SHA256(challenge) }
 *   2. Normal webhooks: Signed with Smartsheet-Hmac-SHA256 header
 *
 * Payload: { webhookId, scope, scopeObjectId, events: [...] }
 *
 * Resolves connection from scopeObjectId in webhook payload via accountId-index.
 *
 * See: https://smartsheet.redoc.ly/tag/webhooks
 */
import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import { createWebhookHandler } from './handler';
import env from '../../env';
import { logInfo, logDebug, logWarn } from '../../lib/logger';
import * as connectionService from '../../services/connection.service';

const router = Router();
router.use(webhookRateLimiter);

// Cache: scopeObjectId → { orgId, connectionId }
const connectionCache = new Map<string, { orgId: string; connectionId: string; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.post('/', (req: Request, res: Response, next: any) => {
  const rawBody = req.body as Buffer;
  let payload: any;

  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // ─── Verification challenge ────────────────────────────────
  // Smartsheet sends { challenge: "random-string" } on webhook creation.
  // We must respond with HMAC-SHA256 of the challenge using the client secret.
  if (payload.challenge) {
    const hmac = crypto
      .createHmac('sha256', env.SMARTSHEET_WEBHOOK_SECRET)
      .update(payload.challenge)
      .digest('hex');

    logInfo('Smartsheet verification challenge responded', { challenge: payload.challenge });
    res.status(200).json({ smartsheetHookResponse: hmac });
    return;
  }

  // ─── Normal webhook ───────────────────────────────────────
  return createWebhookHandler({
    platform: 'smartsheet',
    getSecret: () => env.SMARTSHEET_WEBHOOK_SECRET,
    resolveConnection: async (webhookPayload) => {
      const scopeObjectId = webhookPayload.scopeObjectId?.toString();
      if (!scopeObjectId) return null;

      // Check cache first
      const cached = connectionCache.get(scopeObjectId);
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
        return { orgId: cached.orgId, connectionId: cached.connectionId };
      }

      // Query DynamoDB via accountId-index
      const connection = await connectionService.getConnectionByAccountId(scopeObjectId);
      if (!connection) {
        logWarn('No connection found for Smartsheet scopeObjectId', { scopeObjectId });
        return null;
      }

      connectionCache.set(scopeObjectId, {
        orgId: connection.orgId,
        connectionId: connection.id,
        cachedAt: Date.now(),
      });

      logDebug('Resolved Smartsheet webhook connection', {
        scopeObjectId,
        orgId: connection.orgId,
        connectionId: connection.id,
      });

      return { orgId: connection.orgId, connectionId: connection.id };
    },
  })(req, res, next);
});

export default router;
