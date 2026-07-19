/**
 * Middesk Webhook Route — Baton
 * POST /api/webhooks/middesk
 *
 * Middesk sends business verification events signed with HMAC-SHA256.
 * Connection is resolved from the business ID in the payload.
 *
 * Payload: { type, created_at, data: { object: { id, name, status, ... } } }
 *
 * See: https://docs.middesk.com/docs/webhooks
 */
import { Router } from 'express';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import { createWebhookHandler } from './handler';
import { logDebug, logWarn } from '../../lib/logger';
import * as connectionService from '../../services/connection.service';
import env from '../../env';

const router = Router();
router.use(webhookRateLimiter);

// Cache: businessId → { orgId, connectionId }
const connectionCache = new Map<string, { orgId: string; connectionId: string; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.post('/', createWebhookHandler({
  platform: 'middesk',
  getSecret: () => env.MIDDESK_WEBHOOK_SECRET,
  resolveConnection: async (payload) => {
    const businessId = payload.data?.object?.id?.toString();
    if (!businessId) {
      logWarn('Middesk webhook missing business ID', { type: payload.type });
      return null;
    }

    const cached = connectionCache.get(businessId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return { orgId: cached.orgId, connectionId: cached.connectionId };
    }

    const connection = await connectionService.getConnectionByAccountId(businessId);
    if (!connection) {
      logWarn('No connection found for Middesk business', { businessId });
      return null;
    }

    connectionCache.set(businessId, {
      orgId: connection.orgId,
      connectionId: connection.id,
      cachedAt: Date.now(),
    });

    logDebug('Resolved Middesk webhook connection', {
      businessId,
      orgId: connection.orgId,
      connectionId: connection.id,
    });

    return { orgId: connection.orgId, connectionId: connection.id };
  },
}));

export default router;
