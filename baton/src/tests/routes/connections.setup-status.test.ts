/**
 * Tests for Docusign guided OAuth setup:
 *  - GET /api/connections/docusign/setup-status (configured / unconfigured shapes)
 *  - POST /api/connections/:platform/authorize 409 guard when unconfigured
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// ─── Hoisted mocks ──────────────────────────────────────────

const mockEnv = vi.hoisted(() => ({
  API_URL: 'http://localhost:3001',
  FRONTEND_URL: 'http://localhost:3002',
  DOCUSIGN_INTEGRATION_KEY: '',
  DOCUSIGN_SECRET_KEY: '',
  DOCUSIGN_OAUTH_BASE: 'https://account-d.docusign.com',
}));
vi.mock('../../env', () => ({ default: mockEnv }));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../middleware/rbac', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireViewer: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('../../middleware/error-handler', () => ({
  NotFoundError: class NotFoundError extends Error {
    statusCode = 404;
    constructor(resource: string) { super(`${resource} not found`); this.name = 'NotFoundError'; }
  },
  ValidationError: class ValidationError extends Error {
    statusCode = 400;
    constructor(message: string) { super(message); this.name = 'ValidationError'; }
  },
}));

const mockGetConnectionByOrgAndPlatform = vi.fn();
vi.mock('../../services/connection.service', () => ({
  getConnectionByOrgAndPlatform: (...args: any[]) => mockGetConnectionByOrgAndPlatform(...args),
}));

const mockAuthorize = vi.fn();
vi.mock('../../services/connectors', () => ({
  hasConnector: vi.fn(() => true),
  getConnector: vi.fn(() => ({ authorize: mockAuthorize })),
}));

vi.mock('../../services/oauth-state.service', () => ({
  storeOAuthState: vi.fn(async () => undefined),
  retrieveOAuthState: vi.fn(),
}));
vi.mock('../../services/audit.service', () => ({ logAudit: vi.fn() }));
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: vi.fn() })),
  TableNames: { WORKFLOWS: 'baton-workflows' },
}));

// ─── Import router after mocks ──────────────────────────────

import connectionsRouter from '../../routes/connections';

// ─── Test helpers (same pattern as notifications.test.ts) ───

function makeReq(overrides: any = {}): Request {
  return {
    auth: { userId: 'user-1', orgId: 'org-1' },
    query: {},
    params: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const res: any = {};
  res.json = vi.fn(() => res);
  res.status = vi.fn(() => res);
  res.redirect = vi.fn(() => res);
  return res as Response & {
    json: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };
}

function getHandler(method: string, path: string) {
  const layer = (connectionsRouter as any).stack.find((l: any) => {
    if (!l.route) return false;
    return l.route.path === path && l.route.methods[method];
  });
  if (!layer) throw new Error(`No handler found for ${method} ${path}`);
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

beforeEach(() => {
  mockGetConnectionByOrgAndPlatform.mockReset();
  mockAuthorize.mockReset();
  mockEnv.DOCUSIGN_INTEGRATION_KEY = '';
  mockEnv.DOCUSIGN_SECRET_KEY = '';
  mockEnv.DOCUSIGN_OAUTH_BASE = 'https://account-d.docusign.com';
});

// ─── GET /docusign/setup-status ─────────────────────────────

describe('GET /api/connections/docusign/setup-status', () => {
  const handler = getHandler('get', '/docusign/setup-status');

  it('unconfigured: returns configured=false with redirectUri, oauthBase, developerPortalUrl', async () => {
    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      configured: false,
      redirectUri: 'http://localhost:3001/api/connections/docusign/callback',
      oauthBase: 'https://account-d.docusign.com',
      developerPortalUrl: 'https://developers.docusign.com',
    });
  });

  it('configured: returns configured=true when both keys are set', async () => {
    mockEnv.DOCUSIGN_INTEGRATION_KEY = 'ik-123';
    mockEnv.DOCUSIGN_SECRET_KEY = 'sk-456';

    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      configured: true,
      redirectUri: 'http://localhost:3001/api/connections/docusign/callback',
      oauthBase: 'https://account-d.docusign.com',
      developerPortalUrl: 'https://developers.docusign.com',
    });
  });

  it('half-configured: integration key alone is not enough', async () => {
    mockEnv.DOCUSIGN_INTEGRATION_KEY = 'ik-123';

    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.json.mock.calls[0][0].configured).toBe(false);
  });

  it('redirectUri follows API_URL exactly as the connector builds it', async () => {
    mockEnv.API_URL = 'https://baton.example.com';

    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.json.mock.calls[0][0].redirectUri).toBe(
      'https://baton.example.com/api/connections/docusign/callback',
    );

    mockEnv.API_URL = 'http://localhost:3001';
  });
});

// ─── POST /:platform/authorize — Docusign 409 guard ─────────

describe('POST /api/connections/:platform/authorize — Docusign guard', () => {
  const handler = getHandler('post', '/:platform/authorize');

  it('returns 409 with error payload when Docusign OAuth is not configured', async () => {
    const res = makeRes();
    const next = vi.fn();
    await handler(makeReq({ params: { platform: 'docusign' } }), res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.error).toBe('Docusign OAuth is not configured');
    expect(body.redirectUri).toBe('http://localhost:3001/api/connections/docusign/callback');
    expect(body.developerPortalUrl).toBe('https://developers.docusign.com');
    // No redirect flow was started
    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('proceeds to the OAuth redirect when configured', async () => {
    mockEnv.DOCUSIGN_INTEGRATION_KEY = 'ik-123';
    mockEnv.DOCUSIGN_SECRET_KEY = 'sk-456';
    mockGetConnectionByOrgAndPlatform.mockResolvedValueOnce(null);
    mockAuthorize.mockResolvedValueOnce({
      redirectUrl: 'https://account-d.docusign.com/oauth/auth?client_id=ik-123',
      state: 'state-abc',
    });

    const res = makeRes();
    await handler(makeReq({ params: { platform: 'docusign' } }), res, vi.fn());

    expect(mockAuthorize).toHaveBeenCalledWith('org-1', 'user-1');
    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      redirectUrl: 'https://account-d.docusign.com/oauth/auth?client_id=ik-123',
    });
  });
});
