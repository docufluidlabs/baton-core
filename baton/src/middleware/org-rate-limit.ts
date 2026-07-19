/**
 * Per-Org Rate Limiter — Baton
 *
 * Rate limits API requests based on orgId and plan tier.
 * Must run AFTER auth middleware (needs req.auth.orgId).
 * Uses in-memory cache for plan lookups (5-min TTL).
 */
import rateLimit from 'express-rate-limit';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logDebug, logWarn } from '../lib/logger';

// ─── Plan-based rate limits (requests per minute) ───────────

const PLAN_RATE_LIMITS: Record<string, number> = {
  starter: 100,
  professional: 300,
  business: 1000,
  enterprise: 5000,
};

const DEFAULT_LIMIT = 100;

// ─── In-memory plan cache ───────────────────────────────────

interface CacheEntry {
  plan: string;
  expiresAt: number;
}

const planCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCachedPlan(orgId: string): Promise<string> {
  const cached = planCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.plan;
  }

  try {
    const docClient = getDocClient();
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
      ProjectionExpression: '#p',
      ExpressionAttributeNames: { '#p': 'plan' },
    }));

    const plan = result.Item?.plan || 'starter';
    planCache.set(orgId, { plan, expiresAt: Date.now() + CACHE_TTL_MS });
    return plan;
  } catch (err) {
    logDebug('Failed to fetch org plan for rate limiting, using default', { orgId });
    return 'starter';
  }
}

// ─── Rate Limiter Middleware ────────────────────────────────

export const orgRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: async (req) => {
    const orgId = (req as any).auth?.orgId;
    if (!orgId) return DEFAULT_LIMIT;
    const plan = await getCachedPlan(orgId);
    return PLAN_RATE_LIMITS[plan] || DEFAULT_LIMIT;
  },
  keyGenerator: (req) => (req as any).auth?.orgId || req.ip || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Organization rate limit exceeded. Please try again later.',
    statusCode: 429,
  },
  handler: (req, res, _next, options) => {
    logWarn('Org rate limit exceeded', {
      orgId: (req as any).auth?.orgId,
      ip: req.ip,
      path: req.originalUrl,
      method: req.method,
    });
    res.status(429).json(options.message);
  },
});
