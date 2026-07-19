/**
 * Apps Routes Tests — Baton
 *
 * Tests for:
 *  - GET /api/apps/catalog
 *  - POST /api/apps/preflight
 *  - GET /api/apps
 *  - POST /api/apps (install)
 *  - DELETE /api/apps/:id (soft-delete with rules check)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// ─── Hoisted mocks ────────────────────────────────────────────

const { mockDocSend, mockEncryptToken, mockGetAppTemplate, mockGetAllTemplates, mockLogAudit } =
  vi.hoisted(() => ({
    mockDocSend: vi.fn(),
    mockEncryptToken: vi.fn(),
    mockGetAppTemplate: vi.fn(),
    mockGetAllTemplates: vi.fn(),
    mockLogAudit: vi.fn(),
  }));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));

vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: mockDocSend }),
  TableNames: {
    ORG_APPS: 'baton-org-apps',
    AUTOMATION_RULES: 'baton-automation-rules',
  },
}));

vi.mock('../../lib/app-catalog', () => ({
  getAllAppTemplates: mockGetAllTemplates,
  getAppTemplate: mockGetAppTemplate,
}));

vi.mock('../../lib/encryption', () => ({
  encryptToken: mockEncryptToken,
}));

vi.mock('../../services/audit.service', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/rbac', () => ({
  requireSuperUser: (_req: any, _res: any, next: any) => next(),
  requireViewer: (_req: any, _res: any, next: any) => next(),
}));

import appsRouter from '../../routes/apps';

// ─── Fixtures ─────────────────────────────────────────────────

const ORG_ID = 'org-aaa';
const USER_ID = 'usr-bbb';
const APP_ID = 'app-ccc';
const WEBHOOK_KEY = 'f'.repeat(64);

const procoreTemplate = {
  slug: 'procore',
  name: 'Procore',
  description: 'Construction management',
  logoUrl: '/assets/logos/procore.svg',
  category: 'Construction',
  icon: '🏗️',
  secretKeyLabel: 'Webhook Secret Key',
  secretKeyHint: 'Paste from Procore',
  verificationMethod: { type: 'hmac_sha256', headerName: 'x-procore-signature', encoding: 'hex' },
  setupInstructions: [{ step: 1, title: 'Open portal', description: '...' }],
  supportedEvents: [{ eventType: 'vendors.create', label: 'Vendor Created', description: '' }],
  webhookCapable: true,
};

const installedApp = {
  id: APP_ID,
  orgId: ORG_ID,
  appSlug: 'procore',
  webhookKey: WEBHOOK_KEY,
  secretKeyEnc: 'enc:iv:tag:ct',
  displayName: 'Procore Prod',
  status: 'active',
  addedAt: '2026-01-01T00:00:00.000Z',
  webhookCount: 10,
};

function authReq(overrides: Partial<Request> = {}): Request {
  return {
    auth: { userId: USER_ID, orgId: ORG_ID, role: 'superuser' },
    body: {},
    params: {},
    query: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn((code: number) => { res._status = code; return res; });
  res.json = vi.fn((data: any) => { res._body = data; return res; });
  return res;
}

const next: NextFunction = vi.fn();

// ─── Extract route handler ────────────────────────────────────

function getRoute(method: 'get' | 'post' | 'delete', path: string) {
  const layers = (appsRouter as any).stack as any[];
  const layer = layers.find(
    (l: any) =>
      l.route?.methods?.[method] &&
      l.route.path === path,
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);

  return async (req: Request, res: Response) => {
    for (const s of layer.route.stack) {
      await s.handle(req, res, next);
    }
  };
}

// ─── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockEncryptToken.mockReturnValue('enc:iv:tag:ct');
  mockGetAllTemplates.mockReturnValue([procoreTemplate]);
  mockGetAppTemplate.mockReturnValue(procoreTemplate);
  mockDocSend.mockResolvedValue({});
});

// ── GET /catalog ─────────────────────────────────────────────

describe('GET /api/apps/catalog', () => {
  it('returns templates without verificationMethod', async () => {
    const handler = getRoute('get', '/catalog');
    const res = makeRes();
    await handler(authReq(), res);

    expect(res._body.templates).toHaveLength(1);
    expect(res._body.templates[0]).not.toHaveProperty('verificationMethod');
    expect(res._body.templates[0].name).toBe('Procore');
  });
});

// ── POST /preflight ───────────────────────────────────────────

describe('POST /api/apps/preflight', () => {
  it('returns a 64-char hex webhookKey and webhookUrl', async () => {
    const handler = getRoute('post', '/preflight');
    const req = authReq({ body: { appSlug: 'procore' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._body.webhookKey).toMatch(/^[a-f0-9]{64}$/);
    expect(res._body.webhookUrl).toContain('/api/webhooks/app/');
    expect(res._body.webhookUrl).toContain(res._body.webhookKey);
  });

  it('returns 400 for unknown appSlug', async () => {
    mockGetAppTemplate.mockReturnValue(undefined);

    const handler = getRoute('post', '/preflight');
    const req = authReq({ body: { appSlug: 'totally_unknown' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
  });
});

// ── GET / (list) ──────────────────────────────────────────────

describe('GET /api/apps', () => {
  it('returns installed apps enriched with catalog data (secretKeyEnc stripped)', async () => {
    mockDocSend.mockResolvedValue({ Items: [installedApp] });

    const handler = getRoute('get', '/');
    const res = makeRes();
    await handler(authReq({ query: {} } as any), res);

    expect(res._body.apps).toHaveLength(1);
    const app = res._body.apps[0];

    // secretKeyEnc must never appear
    expect(app).not.toHaveProperty('secretKeyEnc');
    // webhook URL constructed
    expect(app.webhookUrl).toContain(WEBHOOK_KEY);
    // catalog enrichment
    expect(app.name).toBe('Procore');
    expect(app.supportedEvents).toHaveLength(1);
  });

  it('defaults to filtering by status=active', async () => {
    mockDocSend.mockResolvedValue({ Items: [] });

    const handler = getRoute('get', '/');
    await handler(authReq({ query: {} } as any), makeRes());

    expect(mockDocSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({ ':status': 'active' }),
        }),
      }),
    );
  });
});

// ── POST / (install) ──────────────────────────────────────────

describe('POST /api/apps (install)', () => {
  it('installs app, encrypts secret, returns 201 without secretKeyEnc', async () => {
    // No duplicate found
    mockDocSend
      .mockResolvedValueOnce({ Items: [] }) // duplicate check
      .mockResolvedValue({});               // PutCommand

    const handler = getRoute('post', '/');
    const req = authReq({
      body: {
        appSlug: 'procore',
        secretKey: 'super-secret-from-procore',
        displayName: 'Procore Production',
      },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(201);
    expect(res._body.app).not.toHaveProperty('secretKeyEnc');
    expect(res._body.app.webhookUrl).toContain('/api/webhooks/app/');
    expect(res._body.app.status).toBe('active');
    expect(mockEncryptToken).toHaveBeenCalledWith('super-secret-from-procore');
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app.installed' }),
    );
  });

  it('accepts pre-generated webhookKey from preflight', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValue({});

    const handler = getRoute('post', '/');
    const req = authReq({
      body: {
        appSlug: 'procore',
        secretKey: 'my-secret',
        webhookKey: WEBHOOK_KEY,
      },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._body.app.webhookKey).toBe(WEBHOOK_KEY);
  });

  it('returns 409 when app is already installed (active duplicate)', async () => {
    mockDocSend.mockResolvedValueOnce({ Items: [installedApp] });

    const handler = getRoute('post', '/');
    const req = authReq({ body: { appSlug: 'procore', secretKey: 'x' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(409);
    expect(mockEncryptToken).not.toHaveBeenCalled();
  });

  it('returns 400 for unknown appSlug', async () => {
    mockGetAppTemplate.mockReturnValue(undefined);

    const handler = getRoute('post', '/');
    const req = authReq({ body: { appSlug: 'does_not_exist', secretKey: 'x' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
  });

  it('returns 400 when secretKey is empty', async () => {
    const handler = getRoute('post', '/');
    const req = authReq({ body: { appSlug: 'procore', secretKey: '' } });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400); // Zod validation
  });
});

// ── DELETE /:id ───────────────────────────────────────────────

describe('DELETE /api/apps/:id', () => {
  it('soft-deletes app when no active rules reference it', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Item: installedApp })  // GetCommand
      .mockResolvedValueOnce({ Items: [] })            // rules check
      .mockResolvedValue({});                          // UpdateCommand

    const handler = getRoute('delete', '/:id');
    const req = authReq({ params: { id: APP_ID } });
    const res = makeRes();
    await handler(req, res);

    expect(res._body).toEqual({ message: 'App removed', id: APP_ID });
    expect(mockDocSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          UpdateExpression: expect.stringContaining('inactive'),
        }),
      }),
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app.removed' }),
    );
  });

  it('returns 409 when active automation rules reference the app', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Item: installedApp })
      .mockResolvedValueOnce({
        Items: [{ id: 'rule-1', name: 'My Rule', status: 'active' }],
      });

    const handler = getRoute('delete', '/:id');
    const req = authReq({ params: { id: APP_ID } });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(409);
    expect(res._body.message).toContain('My Rule');
  });

  it('returns 404 when app belongs to different org', async () => {
    mockDocSend.mockResolvedValueOnce({
      Item: { ...installedApp, orgId: 'org-other' },
    });

    const handler = getRoute('delete', '/:id');
    const req = authReq({ params: { id: APP_ID } });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(404);
  });

  it('returns 404 when app is already inactive', async () => {
    mockDocSend.mockResolvedValueOnce({
      Item: { ...installedApp, status: 'inactive' },
    });

    const handler = getRoute('delete', '/:id');
    const req = authReq({ params: { id: APP_ID } });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(404);
  });
});
