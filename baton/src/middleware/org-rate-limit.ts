/**
 * API Rate Limiter — Baton
 *
 * Fixed-window rate limiting for all authenticated API routes.
 * Single-org install: one flat limit for everyone, keyed on client IP.
 * Configure via RATE_LIMIT_PER_MINUTE (default 300).
 */
import rateLimit from 'express-rate-limit';
import env from '../env';
import { logWarn } from '../lib/logger';

// ─── Rate Limiter Middleware ────────────────────────────────

export const orgRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: env.RATE_LIMIT_PER_MINUTE,
  keyGenerator: (req) => req.ip || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
    statusCode: 429,
  },
  handler: (req, res, _next, options) => {
    logWarn('Rate limit exceeded', {
      ip: req.ip,
      path: req.originalUrl,
      method: req.method,
    });
    res.status(429).json(options.message);
  },
});
