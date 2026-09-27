/**
 * OAuth callback — what reaches the log — Baton
 *
 * GET /api/connections/:platform/callback receives the authorization code and
 * the state in its query string. A state that does not validate is logged so
 * the failure can be traced, by prefix only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

const { mockLogError, mockRetrieveOAuthState } = vi.hoisted(() => ({
  mockLogError: vi.fn(),
  mockRetrieveOAuthState: vi.fn(),
}));

vi.mock('../../env', () => ({
  default: { API_URL: 'http://localhost:3001', FRONTEND_URL: 'http://localhost:3002' },
}));
vi.mock('../../middleware/auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../middleware/rbac', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireViewer: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../lib/logger', () => ({ logInfo: vi.fn(), logError: mockLogError }));
vi.mock('../../middleware/error-handler', () => ({
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
}));
vi.mock('../../services/connection.service', () => ({}));
vi.mock('../../services/connectors', () => ({ getConnector: vi.fn(), hasConnector: vi.fn(() => true) }));
vi.mock('../../services/oauth-state.service', () => ({
  storeOAuthState: vi.fn(),
  retrieveOAuthState: mockRetrieveOAuthState,
}));
vi.mock('../../services/audit.service', () => ({ logAudit: vi.fn() }));
vi.mock('../../db/client', () => ({ getDocClient: vi.fn(), TableNames: {} }));

import connectionsRouter from '../../routes/connections';

function getCallbackHandler() {
  const layers = (connectionsRouter as any).stack as any[];
  const layer = layers.find((l: any) => l.route?.path === '/:platform/callback' && l.route.methods.get);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  return async (req: Request, res: Response) => {
    for (const fn of handlers) await fn(req, res, () => {});
  };
}

function makeRes() {
  const res: any = {};
  res.redirect = vi.fn((url: string) => { res._redirect = url; return res; });
  return res as Response & { _redirect?: string };
}

const STATE = 'f3a9c1d27b6e4a58' + '9d0c2e4f6a8b1c3d5e7f9a0b2c4d6e8f';
const CODE = 'authorization-code-value-123';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/connections/:platform/callback', () => {
  it('logs a state that does not validate by its prefix only', async () => {
    mockRetrieveOAuthState.mockResolvedValue(null);
    const res = makeRes();

    await getCallbackHandler()(
      { params: { platform: 'docusign' }, query: { code: CODE, state: STATE } } as unknown as Request,
      res,
    );

    expect(res._redirect).toBe(
      'http://localhost:3002/connections?status=error&platform=docusign&error=invalid_state',
    );
    expect(mockLogError).toHaveBeenCalledWith('Invalid OAuth state', {
      platform: 'docusign',
      state: 'f3a9c1d2...',
    });
    const logged = JSON.stringify(mockLogError.mock.calls);
    expect(logged).not.toContain(STATE);
    expect(logged).not.toContain(CODE);
  });
});
