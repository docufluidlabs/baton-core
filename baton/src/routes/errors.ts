/**
 * Client Error Reporting Endpoint
 * Receives frontend error reports and logs them via Pino.
 *
 * #21: Added rate limiting, payload size cap, and Zod validation to prevent
 * log flooding and log-injection attacks.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { logger } from '../lib/logger';

const router = Router();

// 10 reports per client per minute (#21)
const errorReportLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many error reports — please slow down' },
});

router.use(errorReportLimiter);

// Strict schema: bounded lengths on all fields (#21)
const errorReportSchema = z.object({
  message: z.string().max(500).optional(),
  stack: z.string().max(5000).optional(),
  url: z.string().url().max(500).optional().or(z.literal('')).optional(),
  timestamp: z.string().max(50).optional(),
  userAgent: z.string().max(300).optional(),
  extra: z.record(z.unknown()).optional(),
});

router.post('/', (req: Request, res: Response) => {
  const parseResult = errorReportSchema.safeParse(req.body || {});

  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid error report payload' });
    return;
  }

  const { message, stack, url, timestamp, userAgent, extra } = parseResult.data;

  // Use warn level — client errors don't warrant server error alerts (#21)
  logger.warn(
    {
      source: 'frontend',
      errorMessage: message,
      // Trim stack trace to avoid large log entries
      stack: stack ? stack.slice(0, 2000) : undefined,
      pageUrl: url,
      timestamp,
      userAgent,
      extra,
      userId: req.auth?.userId,
    },
    'Client-side error reported',
  );

  res.status(204).end();
});

export default router;
