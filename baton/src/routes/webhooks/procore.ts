/**
 * Procore Webhook Route — Baton
 * POST /api/webhooks/procore
 *
 * Resolves connection from company_id in webhook payload
 */
import { Router } from 'express';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import { createWebhookHandler } from './handler';
import { logDebug, logWarn } from '../../lib/logger';
import env from '../../env';
import * as connectionService from '../../services/connection.service';

const router = Router();

router.use(webhookRateLimiter);

// Cache: companyId → { orgId, connectionId }
const connectionCache = new Map<string, { orgId: string; connectionId: string; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.post('/', createWebhookHandler({
  platform: 'procore',
  getSecret: () => env.PROCORE_WEBHOOK_SECRET,
  resolveConnection: async (payload) => {
    const companyId = payload.company_id?.toString();
    if (!companyId) return null;

    // Check cache first
    const cached = connectionCache.get(companyId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return { orgId: cached.orgId, connectionId: cached.connectionId };
    }

    // Query DynamoDB via accountId-index
    const connection = await connectionService.getConnectionByAccountId(companyId);
    if (!connection) {
      logWarn('No connection found for Procore companyId', { companyId });
      return null;
    }

    connectionCache.set(companyId, {
      orgId: connection.orgId,
      connectionId: connection.id,
      cachedAt: Date.now(),
    });

    logDebug('Resolved Procore webhook connection', {
      companyId,
      orgId: connection.orgId,
      connectionId: connection.id,
    });

    return { orgId: connection.orgId, connectionId: connection.id };
  },
}));

export default router;
