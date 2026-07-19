/**
 * Salesforce Webhook Route — Baton
 * POST /api/webhooks/salesforce
 *
 * Salesforce sends webhook events from Outbound Messages or Platform Events.
 * Each event contains an organizationId used to resolve the connection.
 */
import { Router } from 'express';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import { createWebhookHandler } from './handler';
import { logDebug, logWarn } from '../../lib/logger';
import * as connectionService from '../../services/connection.service';

const router = Router();
router.use(webhookRateLimiter);

// Cache: orgIdentifier → { orgId, connectionId, webhookSecret }
const connectionCache = new Map<string, { orgId: string; connectionId: string; webhookSecret?: string; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

router.post('/', createWebhookHandler({
  platform: 'salesforce',
  // Secret is per-connection (set in the Baton UI when the automation is created),
  // not a global env var. Pulled from the PlatformConnection row resolved below.
  getSecret: (_req, ctx) => ctx?.webhookSecret || '',
  resolveConnection: async (payload) => {
    const sfOrgId = payload.organizationId?.toString() || payload.orgId?.toString();
    if (!sfOrgId) {
      logWarn('Salesforce webhook missing organizationId', { payload });
      return null;
    }

    const cached = connectionCache.get(sfOrgId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return {
        orgId: cached.orgId,
        connectionId: cached.connectionId,
        webhookSecret: cached.webhookSecret,
      };
    }

    const connection = await connectionService.getConnectionByAccountId(sfOrgId);
    if (!connection) {
      logWarn('No connection found for Salesforce org', { sfOrgId });
      return null;
    }

    connectionCache.set(sfOrgId, {
      orgId: connection.orgId,
      connectionId: connection.id,
      webhookSecret: connection.webhookSecret,
      cachedAt: Date.now(),
    });

    logDebug('Resolved Salesforce webhook connection', {
      sfOrgId,
      orgId: connection.orgId,
      connectionId: connection.id,
    });

    return {
      orgId: connection.orgId,
      connectionId: connection.id,
      webhookSecret: connection.webhookSecret,
    };
  },
}));

export default router;
