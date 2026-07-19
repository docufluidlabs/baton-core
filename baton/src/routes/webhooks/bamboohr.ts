/**
 * BambooHR Webhook Route — Baton
 * POST /api/webhooks/bamboohr
 *
 * BambooHR webhook verification:
 *   - x-bamboohr-timestamp header
 *   - x-bamboohr-signature header (HMAC-SHA256 of body + timestamp)
 *
 * Payload: { companyDomain: "acme", employees: [{ id, changedFields: [...] }] }
 *
 * Resolves connection from companyDomain in webhook payload via accountId-index.
 */
import { Router } from 'express';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import { createWebhookHandler } from './handler';
import { logDebug, logWarn } from '../../lib/logger';
import env from '../../env';
import * as connectionService from '../../services/connection.service';

const router = Router();
router.use(webhookRateLimiter);

// Cache: companyDomain → { orgId, connectionId }
const connectionCache = new Map<string, { orgId: string; connectionId: string; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.post('/', createWebhookHandler({
  platform: 'bamboohr',
  getSecret: () => env.BAMBOOHR_WEBHOOK_SECRET,
  resolveConnection: async (payload) => {
    // Support both formats:
    //   new: { data: { companyId } }
    //   legacy: { companyDomain }
    const companyDomain = payload.data?.companyId?.toString() ?? payload.companyDomain?.toString();
    if (!companyDomain) return null;

    // Check cache first
    const cached = connectionCache.get(companyDomain);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return { orgId: cached.orgId, connectionId: cached.connectionId };
    }

    // Query DynamoDB via accountId-index
    const connection = await connectionService.getConnectionByAccountId(companyDomain);
    if (!connection) {
      logWarn('No connection found for BambooHR companyDomain', { companyDomain });
      return null;
    }

    connectionCache.set(companyDomain, {
      orgId: connection.orgId,
      connectionId: connection.id,
      cachedAt: Date.now(),
    });

    logDebug('Resolved BambooHR webhook connection', {
      companyDomain,
      orgId: connection.orgId,
      connectionId: connection.id,
    });

    return { orgId: connection.orgId, connectionId: connection.id };
  },
}));

export default router;
