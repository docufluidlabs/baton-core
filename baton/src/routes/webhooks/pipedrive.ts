/**
 * Pipedrive Webhook Route — Baton
 * POST /api/webhooks/pipedrive
 *
 * Pipedrive sends webhook events with a meta.company_id used to resolve the connection.
 */
import { Router } from 'express';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import { createWebhookHandler } from './handler';
import { logDebug, logWarn } from '../../lib/logger';
import * as connectionService from '../../services/connection.service';
import env from '../../env';

const router = Router();
router.use(webhookRateLimiter);

// Cache: companyId → { orgId, connectionId }
const connectionCache = new Map<string, { orgId: string; connectionId: string; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

router.post('/', createWebhookHandler({
  platform: 'pipedrive',
  getSecret: () => env.PIPEDRIVE_WEBHOOK_SECRET,
  resolveConnection: async (payload) => {
    const companyId = payload.meta?.company_id?.toString();
    if (!companyId) {
      logWarn('Pipedrive webhook missing meta.company_id', { event: payload.event });
      return null;
    }

    const cached = connectionCache.get(companyId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return { orgId: cached.orgId, connectionId: cached.connectionId };
    }

    const connection = await connectionService.getConnectionByAccountId(companyId);
    if (!connection) {
      logWarn('No connection found for Pipedrive company', { companyId });
      return null;
    }

    connectionCache.set(companyId, {
      orgId: connection.orgId,
      connectionId: connection.id,
      cachedAt: Date.now(),
    });

    logDebug('Resolved Pipedrive webhook connection', {
      companyId,
      orgId: connection.orgId,
      connectionId: connection.id,
    });

    return { orgId: connection.orgId, connectionId: connection.id };
  },
}));

export default router;
