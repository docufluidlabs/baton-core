/**
 * Error Handler Middleware — Baton
 */
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string = 'Resource') {
    super(`${entity} not found`, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId;
  const log = req.log || logger;

  // Zod validation errors
  if (err instanceof ZodError) {
    log.warn(
      { path: req.path, method: req.method, errors: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })) },
      'Validation error (Zod)',
    );
    res.status(400).json({
      error: 'Validation Error',
      message: 'Request validation failed',
      statusCode: 400,
      requestId,
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // App errors — log ALL by severity
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      log.error({ err, path: req.path, method: req.method, statusCode: err.statusCode }, `AppError: ${err.message}`);
    } else if (err.statusCode === 401 || err.statusCode === 403) {
      log.warn({ err, path: req.path, method: req.method, statusCode: err.statusCode }, `AppError: ${err.message}`);
    } else {
      log.info({ path: req.path, method: req.method, statusCode: err.statusCode }, `AppError: ${err.message}`);
    }
    res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
      statusCode: err.statusCode,
      requestId,
    });
    return;
  }

  // Unknown errors
  log.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    statusCode: 500,
    requestId,
  });
}
