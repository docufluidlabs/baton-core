/**
 * HubSpot Webhook Route — Baton
 * POST /api/webhooks/hubspot
 *
 * HubSpot sends batched webhook events as a JSON array.
 * Each event contains a portalId used to resolve the connection.
 * Signature verification uses HMAC-SHA256 v3 (method + uri + body + timestamp).
 */
import { Router, Request, Response } from 'express';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import { createWebhookHandler } from './handler';
import { logDebug, logWarn } from '../../lib/logger';
import * as connectionService from '../../services/connection.service';
import env from '../../env';

const router = Router();
router.use(webhookRateLimiter);

// Inject full request URL into headers so the connector can build the v3 source string.
// HubSpot signs the request using the Target URL configured in their UI, so we must
// reconstruct the same URL. When behind a reverse proxy / tunnel (e.g. ngrok) prefer
// the x-forwarded-* headers; for HubSpot v3 specifically we also need the original
// scheme + host exactly as HubSpot sees them.
router.use((req: Request, _res: Response, next) => {
  const protocol = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  const uri = `${protocol}://${host}${req.originalUrl}`;
  logDebug('HubSpot webhook URI reconstruction', { protocol, host, originalUrl: req.originalUrl, uri });
  req.headers['x-baton-request-uri'] = uri;
  next();
});

// Cache: portalId → { orgId, connectionId }
const connectionCache = new Map<string, { orgId: string; connectionId: string; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.post('/', createWebhookHandler({
  platform: 'hubspot',
  getSecret: () => env.HUBSPOT_WEBHOOK_SECRET,
  resolveConnection: async (payload) => {
    // HubSpot sends an array of events; portalId is in each event
    const events = Array.isArray(payload) ? payload : [payload];
    const portalId = events[0]?.portalId?.toString();
    if (!portalId) {
      // Simple format (e.g. { objectId }) — no portalId, cannot resolve connection
      logDebug('HubSpot webhook received without portalId (simple format)', { payload: events[0] });
      return null;
    }

    // Check cache first
    const cached = connectionCache.get(portalId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return { orgId: cached.orgId, connectionId: cached.connectionId };
    }

    // Query DynamoDB via accountId-index
    const connection = await connectionService.getConnectionByAccountId(portalId);
    if (!connection) {
      logWarn('No connection found for HubSpot portal', { portalId });
      return null;
    }

    connectionCache.set(portalId, {
      orgId: connection.orgId,
      connectionId: connection.id,
      cachedAt: Date.now(),
    });

    logDebug('Resolved HubSpot webhook connection', {
      portalId,
      orgId: connection.orgId,
      connectionId: connection.id,
    });

    return { orgId: connection.orgId, connectionId: connection.id };
  },
}));

export default router;
