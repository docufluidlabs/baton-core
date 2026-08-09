/**
 * Auth Middleware Tests — local session provider
 * Covers: baton_session cookie verification, dev bypass, 401 paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-test-secret-test-secret!';

const { mockEnv, mockSend } = vi.hoisted(() => ({
  mockEnv: {
    NODE_ENV: 'development',
    DEV_AUTH_BYPASS: true,
    AUTH_JWT_SECRET: 'test-secret-test-secret-test-secret!',
    BATON_ORG_ID: 'default-org',
    FRONTEND_URL: 'http://localhost:3002',
  },
  mockSend: vi.fn(),
}));

vi.mock('../../env', () => ({ default: mockEnv }));
vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: { USERS: 'baton-users', ORGANIZATIONS: 'baton-organizations' },
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

/** Run requireAuth and resolve with whatever next() was called with. */
function runAuth(req: Request): Promise<unknown> {
  return new Promise((resolve) => {
    requireAuth(req, mockRes(), (err?: unknown) => resolve(err));
  });
}

function sessionCookie(userId: string, opts: { expired?: boolean } = {}): string {
  const token = jwt.sign({ userId }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: opts.expired ? -60 : 3600,
  });
  return `baton_session=${token}`;
}

const activeUser = {
  id: 'user-1',
  orgId: 'org-1',
  email: 'user@example.com',
  role: 'admin',
  passwordHash: '$2a$12$hash',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.NODE_ENV = 'development';
  mockEnv.DEV_AUTH_BYPASS = true;
  mockSend.mockResolvedValue({ Item: activeUser });
});

// ─── Development Bypass ──────────────────────────────────────

describe('requireAuth — dev bypass', () => {
  it('sets auth from dev headers and calls next', async () => {
    const req = mockReq({
      headers: {
        'x-dev-userid': 'dev-user-1',
        'x-dev-orgid': 'dev-org-1',
        'x-dev-role': 'member',
      },
    });

    const err = await runAuth(req);

    expect(err).toBeUndefined();
    expect(req.auth).toEqual({
      userId: 'dev-user-1',
      orgId: 'dev-org-1',
      role: 'member',
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('defaults role to viewer when X-Dev-Role is not provided (#23)', async () => {
    const req = mockReq({
      headers: { 'x-dev-userid': 'u1', 'x-dev-orgid': 'o1' },
    });

    const err = await runAuth(req);

    expect(err).toBeUndefined();
    expect(req.auth?.role).toBe('viewer');
  });

  it('does not bypass when dev headers are missing in development', async () => {
    const req = mockReq({ headers: {} });

    const err = await runAuth(req) as Error & { statusCode: number };

    expect(err).toBeDefined();
    expect(err.message).toContain('No valid session');
    expect(err.statusCode).toBe(401);
  });

  it('does not use dev bypass in production mode', async () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.DEV_AUTH_BYPASS = false;
    const req = mockReq({
      headers: { 'x-dev-userid': 'u1', 'x-dev-orgid': 'o1' },
    });

    const err = await runAuth(req) as Error & { statusCode: number };

    expect(err).toBeDefined();
    expect(err.statusCode).toBe(401);
    expect(req.auth).toBeUndefined();
  });
});

// ─── Session Cookie Path ─────────────────────────────────────

describe('requireAuth — baton_session cookie', () => {
  beforeEach(() => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.DEV_AUTH_BYPASS = false;
  });

  it('authenticates a valid session cookie and populates req.auth from the user row', async () => {
    const req = mockReq({ headers: { cookie: sessionCookie('user-1') } });

    const err = await runAuth(req);

    expect(err).toBeUndefined();
    expect(req.auth).toEqual({
      userId: 'user-1',
      orgId: 'org-1',
      role: 'admin',
    });
    // Loaded the user row by id
    const getInput = mockSend.mock.calls[0][0].input;
    expect(getInput.TableName).toBe('baton-users');
    expect(getInput.Key).toEqual({ id: 'user-1' });
  });

  it('parses the cookie among other cookies in the header', async () => {
    const req = mockReq({
      headers: { cookie: `other=abc; ${sessionCookie('user-1')}; theme=dark` },
    });

    const err = await runAuth(req);

    expect(err).toBeUndefined();
    expect(req.auth?.userId).toBe('user-1');
  });

  it('falls back to BATON_ORG_ID when the user row has no orgId', async () => {
    mockSend.mockResolvedValue({ Item: { ...activeUser, orgId: undefined } });
    const req = mockReq({ headers: { cookie: sessionCookie('user-1') } });

    const err = await runAuth(req);

    expect(err).toBeUndefined();
    expect(req.auth?.orgId).toBe('default-org');
  });

  it('401s when there is no cookie', async () => {
    const req = mockReq({ headers: {} });

    const err = await runAuth(req) as Error & { statusCode: number };

    expect(err.statusCode).toBe(401);
    expect(err.message).toContain('No valid session');
  });

  it('401s on a tampered token', async () => {
    const badToken = jwt.sign({ userId: 'user-1' }, 'wrong-secret-wrong-secret-wrong!', {
      algorithm: 'HS256',
      expiresIn: 3600,
    });
    const req = mockReq({ headers: { cookie: `baton_session=${badToken}` } });

    const err = await runAuth(req) as Error & { statusCode: number };

    expect(err.statusCode).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('401s on an expired token', async () => {
    const req = mockReq({ headers: { cookie: sessionCookie('user-1', { expired: true }) } });

    const err = await runAuth(req) as Error & { statusCode: number };

    expect(err.statusCode).toBe(401);
  });

  it('401s when the session user no longer exists', async () => {
    mockSend.mockResolvedValue({ Item: undefined });
    const req = mockReq({ headers: { cookie: sessionCookie('deleted-user') } });

    const err = await runAuth(req) as Error & { statusCode: number };

    expect(err.statusCode).toBe(401);
  });

  it('401s for a pending-invite user without a password', async () => {
    mockSend.mockResolvedValue({
      Item: { id: 'user-2', orgId: 'org-1', role: 'member', inviteToken: 'tok' },
    });
    const req = mockReq({ headers: { cookie: sessionCookie('user-2') } });

    const err = await runAuth(req) as Error & { statusCode: number };

    expect(err.statusCode).toBe(401);
  });
});
