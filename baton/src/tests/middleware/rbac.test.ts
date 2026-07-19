/**
 * RBAC Middleware Tests
 */
import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { requireRole, requireAdmin, requireMember, requireViewer } from '../../middleware/rbac';

vi.mock('../../middleware/error-handler', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/error-handler')>('../../middleware/error-handler');
  return actual;
});

// ─── Helpers ──────────────────────────────────────────────────

function mockReq(auth?: { userId: string; orgId: string; role: string }): Request {
  return { auth } as unknown as Request;
}

function mockRes(): Response {
  return {} as Response;
}

// ─── requireRole ─────────────────────────────────────────────

describe('requireRole', () => {
  it('calls next() when role is in allowed list', () => {
    const middleware = requireRole('admin', 'owner');
    const next = vi.fn();

    middleware(mockReq({ userId: 'u1', orgId: 'o1', role: 'admin' }), mockRes(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(UnauthorizedError) when auth is missing', () => {
    const middleware = requireRole('admin');
    const next = vi.fn();

    middleware(mockReq(undefined), mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(401);
  });

  it('calls next(ForbiddenError) when role is not in allowed list', () => {
    const middleware = requireRole('admin', 'owner');
    const next = vi.fn();

    middleware(mockReq({ userId: 'u1', orgId: 'o1', role: 'viewer' }), mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('viewer');
  });

  it('allows owner role when admin is required', () => {
    const middleware = requireRole('admin', 'owner');
    const next = vi.fn();

    middleware(mockReq({ userId: 'u1', orgId: 'o1', role: 'owner' }), mockRes(), next);

    expect(next).toHaveBeenCalledWith();
  });
});

// ─── Pre-configured middlewares ──────────────────────────────

describe('requireAdmin', () => {
  it('allows admin', () => {
    const next = vi.fn();
    requireAdmin(mockReq({ userId: 'u1', orgId: 'o1', role: 'admin' }), mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows owner', () => {
    const next = vi.fn();
    requireAdmin(mockReq({ userId: 'u1', orgId: 'o1', role: 'owner' }), mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks member', () => {
    const next = vi.fn();
    requireAdmin(mockReq({ userId: 'u1', orgId: 'o1', role: 'member' }), mockRes(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('blocks viewer', () => {
    const next = vi.fn();
    requireAdmin(mockReq({ userId: 'u1', orgId: 'o1', role: 'viewer' }), mockRes(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });
});

describe('requireMember', () => {
  it('allows member', () => {
    const next = vi.fn();
    requireMember(mockReq({ userId: 'u1', orgId: 'o1', role: 'member' }), mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows admin', () => {
    const next = vi.fn();
    requireMember(mockReq({ userId: 'u1', orgId: 'o1', role: 'admin' }), mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks viewer', () => {
    const next = vi.fn();
    requireMember(mockReq({ userId: 'u1', orgId: 'o1', role: 'viewer' }), mockRes(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });
});

describe('requireViewer', () => {
  it('allows viewer', () => {
    const next = vi.fn();
    requireViewer(mockReq({ userId: 'u1', orgId: 'o1', role: 'viewer' }), mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows admin', () => {
    const next = vi.fn();
    requireViewer(mockReq({ userId: 'u1', orgId: 'o1', role: 'admin' }), mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows member', () => {
    const next = vi.fn();
    requireViewer(mockReq({ userId: 'u1', orgId: 'o1', role: 'member' }), mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows owner', () => {
    const next = vi.fn();
    requireViewer(mockReq({ userId: 'u1', orgId: 'o1', role: 'owner' }), mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks unauthenticated', () => {
    const next = vi.fn();
    requireViewer(mockReq(undefined), mockRes(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });
});
