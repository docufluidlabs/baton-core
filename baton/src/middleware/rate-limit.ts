import rateLimit from 'express-rate-limit';
import { logWarn } from '../lib/logger';

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // limit each IP to 2000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Rate limit exceeded', statusCode: 429 },
  handler: (req, res, _next, options) => {
    logWarn('Global rate limit exceeded', { ip: req.ip, path: req.originalUrl, method: req.method });
    res.status(429).json(options.message);
  },
});

export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // webhooks can be bursty
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logWarn('Webhook rate limit exceeded', { ip: req.ip, path: req.originalUrl, method: req.method });
    res.status(429).json({ error: 'Too Many Requests', message: 'Webhook rate limit exceeded', statusCode: 429 });
  },
});
