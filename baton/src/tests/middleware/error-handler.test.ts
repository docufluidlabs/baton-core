import { describe, it, expect, vi } from 'vitest';
import { ZodError, ZodIssue, ZodIssueCode } from 'zod';
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  errorHandler,
} from '../../middleware/error-handler';

vi.mock('../../lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const mockReq = {} as any;
const mockNext = vi.fn();

// ─── AppError Classes ───────────────────────────────────────

describe('AppError classes', () => {
  it('AppError has default statusCode 500', () => {
    const err = new AppError('test');
    expect(err.statusCode).toBe(500);
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe('test');
  });

  it('AppError accepts custom statusCode', () => {
    const err = new AppError('custom', 418);
    expect(err.statusCode).toBe(418);
  });

  it('NotFoundError has statusCode 404', () => {
    const err = new NotFoundError('User');
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('User');
    expect(err.message).toContain('not found');
  });

  it('UnauthorizedError has statusCode 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
  });

  it('ForbiddenError has statusCode 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
  });

  it('ValidationError has statusCode 400', () => {
    const err = new ValidationError('bad input');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('bad input');
  });

  it('all are instanceof Error', () => {
    expect(new AppError('x')).toBeInstanceOf(Error);
    expect(new NotFoundError()).toBeInstanceOf(AppError);
    expect(new UnauthorizedError()).toBeInstanceOf(AppError);
  });
});

// ─── errorHandler Middleware ────────────────────────────────

describe('errorHandler middleware', () => {
  it('ZodError returns 400 with details', () => {
    const issues: ZodIssue[] = [
      { code: ZodIssueCode.invalid_type, path: ['name'], message: 'Required', expected: 'string', received: 'undefined' },
    ];
    const err = new ZodError(issues);
    const res = createMockRes();

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation Error',
        statusCode: 400,
        details: expect.arrayContaining([
          expect.objectContaining({ path: 'name', message: 'Required' }),
        ]),
      }),
    );
  });

  it('AppError returns correct statusCode', () => {
    const err = new NotFoundError('Item');
    const res = createMockRes();

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it('unknown Error returns 500', () => {
    const err = new Error('something broke');
    const res = createMockRes();

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Internal Server Error',
        statusCode: 500,
      }),
    );
  });
});
