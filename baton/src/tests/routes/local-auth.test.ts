/**
 * Local Auth Route Tests — /api/auth (public)
 * Covers: status (needsSetup), setup (happy + already-done), login
 * (success / bad password / unknown email — uniform 401), accept-invite
 * (happy + expired).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';

const { mockEnv, mockSend } = vi.hoisted(() => ({
  mockEnv: {
    NODE_ENV: 'test',
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

import localAuthRouter from '../../routes/local-auth';

// ─── Test helpers ────────────────────────────────────────────

function getHandler(method: string, path: string) {
  const layer = (localAuthRouter as any).stack.find((l: any) => {
    if (!l.route) return false;
    return l.route.path === path && l.route.methods[method];
  });
  if (!layer) throw new Error(`No handler found for ${method} ${path}`);
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

function makeReq(body: any = {}): Request {
  return { body, headers: {}, cookies: {} } as unknown as Request;
}

function makeRes() {
  const res: any = {};
  res.json = vi.fn(() => res);
  res.status = vi.fn(() => res);
  res.cookie = vi.fn(() => res);
  res.clearCookie = vi.fn(() => res);
  return res as Response & {
    json: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };
}

// Low bcrypt cost keeps tests fast; verifyPassword compares against any cost.
const PASSWORD = 'correct-horse-battery';
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

const owner = {
  id: 'user-1',
  orgId: 'default-org',
  email: 'owner@example.com',
  fullName: 'Owner One',
  firstName: 'Owner',
  lastName: 'One',
  role: 'owner',
  passwordHash,
};

const org = {
  id: 'default-org',
  name: 'Acme',
  plan: 'enterprise',
  executionsUsed: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── GET /status ─────────────────────────────────────────────

describe('GET /api/auth/status', () => {
  const handler = getHandler('get', '/status');

  it('reports needsSetup true when zero users exist', async () => {
    mockSend.mockResolvedValueOnce({ Count: 0 });
    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ needsSetup: true });
    // Efficient check: COUNT scan capped at 1 row
    const scanInput = mockSend.mock.calls[0][0].input;
    expect(scanInput.Select).toBe('COUNT');
    expect(scanInput.Limit).toBe(1);
  });

  it('reports needsSetup false when users exist', async () => {
    mockSend.mockResolvedValueOnce({ Count: 1 });
    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ needsSetup: false });
  });
});

// ─── POST /setup ─────────────────────────────────────────────

describe('POST /api/auth/setup', () => {
  const handler = getHandler('post', '/setup');
  const body = {
    orgName: 'Acme',
    name: 'Owner One',
    email: 'owner@example.com',
    password: 'super-secret-1',
  };

  it('creates org + owner, sets the session cookie, returns the /me shape', async () => {
    mockSend.mockResolvedValueOnce({ Count: 0 }); // needsSetup
    mockSend.mockResolvedValue({});               // org Put, user Put

    const res = makeRes();
    await handler(makeReq(body), res, vi.fn());

    // Org row: id = BATON_ORG_ID, top-tier plan so nothing downstream gates
    const orgPut = mockSend.mock.calls[1][0].input;
    expect(orgPut.TableName).toBe('baton-organizations');
    expect(orgPut.Item.id).toBe('default-org');
    expect(orgPut.Item.name).toBe('Acme');
    expect(orgPut.Item.plan).toBe('enterprise');
    expect(orgPut.Item.exemptFromMeter).toBe(true);

    // Owner row: hashed password, owner role
    const userPut = mockSend.mock.calls[2][0].input;
    expect(userPut.TableName).toBe('baton-users');
    expect(userPut.Item.role).toBe('owner');
    expect(userPut.Item.email).toBe('owner@example.com');
    expect(userPut.Item.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(userPut.Item.passwordHash).not.toBe(body.password);

    expect(res.cookie).toHaveBeenCalledWith(
      'baton_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    expect(payload.user.email).toBe('owner@example.com');
    expect(payload.user.role).toBe('owner');
    expect(payload.organization.id).toBe('default-org');
    expect(payload.organization.plan).toBe('enterprise');
  });

  it('rejects setup when users already exist', async () => {
    mockSend.mockResolvedValueOnce({ Count: 1 });

    const res = makeRes();
    const next = vi.fn();
    await handler(makeReq(body), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    // Only the count check ran — nothing was written
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

// ─── POST /login ─────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  const handler = getHandler('post', '/login');

  it('logs in with valid credentials and sets the session cookie', async () => {
    mockSend.mockResolvedValueOnce({ Items: [owner] }); // email scan
    mockSend.mockResolvedValueOnce({ Item: org });       // org get

    const res = makeRes();
    await handler(makeReq({ email: 'owner@example.com', password: PASSWORD }), res, vi.fn());

    expect(res.cookie).toHaveBeenCalledWith(
      'baton_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.user.id).toBe('user-1');
    expect(payload.organization.name).toBe('Acme');
  });

  it('returns uniform 401 for a bad password', async () => {
    mockSend.mockResolvedValueOnce({ Items: [owner] });

    const res = makeRes();
    const next = vi.fn();
    await handler(makeReq({ email: 'owner@example.com', password: 'wrong-password' }), res, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid credentials');
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('returns the same uniform 401 for an unknown email', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const res = makeRes();
    const next = vi.fn();
    await handler(makeReq({ email: 'nobody@example.com', password: 'whatever-123' }), res, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid credentials');
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

// ─── POST /logout ────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  const handler = getHandler('post', '/logout');

  it('clears the session cookie', async () => {
    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.clearCookie).toHaveBeenCalledWith('baton_session', expect.any(Object));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

// ─── POST /accept-invite ─────────────────────────────────────

describe('POST /api/auth/accept-invite', () => {
  const handler = getHandler('post', '/accept-invite');

  const invitedUser = {
    id: 'user-2',
    orgId: 'default-org',
    email: 'invitee@example.com',
    role: 'member',
    inviteToken: 'a'.repeat(64),
    inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  const body = { token: 'a'.repeat(64), name: 'New Member', password: 'super-secret-2' };

  it('activates the account, clears invite fields, sets the cookie', async () => {
    mockSend.mockResolvedValueOnce({ Items: [invitedUser] }); // token scan
    mockSend.mockResolvedValueOnce({});                        // update
    mockSend.mockResolvedValueOnce({ Item: org });             // org get

    const res = makeRes();
    await handler(makeReq(body), res, vi.fn());

    const update = mockSend.mock.calls[1][0].input;
    expect(update.TableName).toBe('baton-users');
    expect(update.Key).toEqual({ id: 'user-2' });
    expect(update.UpdateExpression).toContain('REMOVE inviteToken, inviteExpiresAt');
    expect(update.ExpressionAttributeValues[':ph']).toMatch(/^\$2[aby]\$/);

    expect(res.cookie).toHaveBeenCalledWith('baton_session', expect.any(String), expect.any(Object));
    const payload = res.json.mock.calls[0][0];
    expect(payload.user.id).toBe('user-2');
    expect(payload.user.firstName).toBe('New');
    expect(payload.user.lastName).toBe('Member');
  });

  it('rejects an expired invite', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{
        ...invitedUser,
        inviteExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      }],
    });

    const res = makeRes();
    const next = vi.fn();
    await handler(makeReq(body), res, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('Invalid or expired invite');
    // No update was attempted
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('rejects an unknown token', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const res = makeRes();
    const next = vi.fn();
    await handler(makeReq(body), res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});
