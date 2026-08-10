/**
 * Docusign Connect Webhook Route — Baton
 * POST /api/webhooks/docusign
 *
 * Docusign Connect sends envelope/recipient events with accountId in payload.
 * We resolve the connection via accountId-index.
 */
import { Router } from 'express';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import { createWebhookHandler } from './handler';
import { logDebug, logWarn } from '../../lib/logger';
import env from '../../env';
import * as connectionService from '../../services/connection.service';

const router = Router();
router.use(webhookRateLimiter);

// Cache: accountId → { orgId, connectionId }
const connectionCache = new Map<string, { orgId: string; connectionId: string; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.post('/', createWebhookHandler({
  platform: 'docusign',
  getSecret: () => env.DOCUSIGN_CONNECT_HMAC_KEY,
  resolveConnection: async (payload) => {
    const accountId = payload.data?.accountId || payload.accountId;
    if (!accountId) return null;

    // Check cache first
    const cached = connectionCache.get(accountId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return { orgId: cached.orgId, connectionId: cached.connectionId };
    }

    // Query DynamoDB via accountId-index
    const connection = await connectionService.getConnectionByAccountId(accountId);
    if (!connection) {
      logWarn('No connection found for Docusign accountId', { accountId });
      return null;
    }

    connectionCache.set(accountId, {
      orgId: connection.orgId,
      connectionId: connection.id,
      cachedAt: Date.now(),
    });

    logDebug('Resolved Docusign webhook connection', {
      accountId,
      orgId: connection.orgId,
      connectionId: connection.id,
    });

    return { orgId: connection.orgId, connectionId: connection.id };
  },
}));

export default router;
