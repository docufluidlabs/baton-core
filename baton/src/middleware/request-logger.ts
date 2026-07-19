/**
 * Request Logger Middleware — Baton
 * Logs every incoming request with timing, status, and correlation ID.
 * Attaches a child logger (req.log) with requestId bound for downstream use.
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Logger } from 'pino';
import { createLogger } from '../lib/logger';
import { requestContext } from '../lib/context';

// Extend Request to carry correlation ID and child logger
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      log?: Logger;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Sanitize X-Request-Id to prevent log injection (#26).
  // Only accept well-formed correlation IDs (8-64 word chars / hyphens);
  // anything else gets replaced with a fresh UUID.
  const rawRequestId = req.headers['x-request-id'] as string | undefined;
  const requestId = rawRequestId && /^[\w\-]{8,64}$/.test(rawRequestId)
    ? rawRequestId
    : crypto.randomUUID();
  req.requestId = requestId;
  req.log = createLogger({ requestId });
  res.setHeader('X-Request-Id', requestId);

  requestContext.run({ requestId }, () => {
    const start = Date.now();

    res.on('finish', () => {
      if (req.path === '/health' || req.path === '/api/health') return;
      const duration = Date.now() - start;
      const logData = {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duration,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      };

      if (res.statusCode >= 500) {
        req.log!.error(logData, 'Request completed with server error');
      } else if (res.statusCode >= 400) {
        req.log!.warn(logData, 'Request completed with client error');
      } else {
        req.log!.info(logData, 'Request completed');
      }
    });

    next();
  });
}
