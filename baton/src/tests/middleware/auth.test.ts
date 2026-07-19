/**
 * Auth Middleware Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    NODE_ENV: 'development',
    CLERK_SECRET_KEY: '',
  },
}));

vi.mock('../../env', () => ({ default: mockEnv }));
vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { requireAuth } from '../../middleware/auth';

// ─── Helpers ──────────────────────────────────────────────────

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    cookies: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  return {} as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.NODE_ENV = 'development';
});

// ─── Development Bypass ──────────────────────────────────────

describe('requireAuth — dev bypass', () => {
  it('sets auth from dev headers and calls next', () => {
    const req = mockReq({
      headers: {
        'x-dev-userid': 'dev-user-1',
        'x-dev-orgid': 'dev-org-1',
        'x-dev-role': 'member',
      },
    });
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(req.auth).toEqual({
      userId: 'dev-user-1',
      orgId: 'dev-org-1',
      role: 'member',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('defaults role to admin when not provided', () => {
    const req = mockReq({
      headers: {
        'x-dev-userid': 'u1',
        'x-dev-orgid': 'o1',
      },
    });
    const next = vi.fn();

    requireAuth(req, mockRes(), next);

    expect(req.auth?.role).toBe('admin');
    expect(next).toHaveBeenCalledWith();
  });

  it('does not bypass when dev headers are missing in development', (ctx) => {
    const req = mockReq({ headers: {} });
    const next = vi.fn();

    requireAuth(req, mockRes(), next);

    // Should call next with UnauthorizedError because no Clerk client either
    // Wait for the promise-based clerk path to settle
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(next).toHaveBeenCalled();
        const err = next.mock.calls[0][0];
        expect(err).toBeDefined();
        expect(err.message).toContain('No valid session');
        resolve();
      }, 50);
    });
  });

  it('does not use dev bypass in production mode', () => {
    mockEnv.NODE_ENV = 'production';
    const req = mockReq({
      headers: {
        'x-dev-userid': 'u1',
        'x-dev-orgid': 'o1',
      },
    });
    const next = vi.fn();

    requireAuth(req, mockRes(), next);

    // Should NOT set auth from dev headers — should go to clerk flow
    expect(req.auth).toBeUndefined();

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(next).toHaveBeenCalled();
        const err = next.mock.calls[0][0];
        expect(err).toBeDefined();
        resolve();
      }, 50);
    });
  });
});
