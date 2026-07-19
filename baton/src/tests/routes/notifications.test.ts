import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';

// ─── Hoisted mocks ──────────────────────────────────────────

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: {
    NOTIFICATIONS: 'baton-notifications',
    NOTIFICATION_PREFERENCES: 'baton-notification-preferences',
  },
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/error-handler', () => ({
  NotFoundError: class NotFoundError extends Error {
    statusCode = 404;
    constructor(resource: string) { super(`${resource} not found`); this.name = 'NotFoundError'; }
  },
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

// ─── Import router after mocks ──────────────────────────────

import notificationsRouter from '../../routes/notifications';

// ─── Test app setup ─────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  // Inject auth
  app.use((req: any, _res: any, next: any) => {
    req.auth = { userId: 'user-1', orgId: 'org-1' };
    next();
  });
  app.use('/notifications', notificationsRouter);
  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

// We use supertest-like approach by directly calling the app
// But since we don't have supertest, we'll use node's http testing

// Simpler approach: manually call route handlers
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
  return res as Response & { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };
}

function makeNext() {
  return vi.fn();
}

// Extract route handlers from router stack
function getHandler(method: string, path: string) {
  const layer = (notificationsRouter as any).stack.find((l: any) => {
    if (!l.route) return false;
    return l.route.path === path && l.route.methods[method];
  });
  if (!layer) throw new Error(`No handler found for ${method} ${path}`);
  // Get the last handler (after middleware)
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

// ─── Tests ──────────────────────────────────────────────────

beforeEach(() => {
  mockSend.mockReset();
});

// ── GET /notifications ──────────────────────────────────────

describe('GET /notifications', () => {
  const handler = getHandler('get', '/');

  it('returns notifications with unreadCount for authenticated user', async () => {
    const notifications = [
      { id: 'n1', recipientId: 'user-1', title: 'Alert', readAt: null },
      { id: 'n2', recipientId: 'user-1', title: 'Info', readAt: '2024-01-01' },
    ];
    mockSend.mockResolvedValueOnce({ Items: notifications });

    const req = makeReq({ query: {} });
    const res = makeRes();
    const next = makeNext();

    await handler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      notifications,
      unreadCount: 1,
    });
  });

  it('respects limit param, capped at 100', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = makeReq({ query: { limit: '200' } });
    const res = makeRes();
    await handler(req, res, makeNext());

    const queryCmd = mockSend.mock.calls[0][0];
    expect(queryCmd.input.Limit).toBe(100);
  });

  it('defaults limit to 30 when not provided', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = makeReq({ query: {} });
    const res = makeRes();
    await handler(req, res, makeNext());

    const queryCmd = mockSend.mock.calls[0][0];
    expect(queryCmd.input.Limit).toBe(30);
  });

  it('applies unread filter when unread=true', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = makeReq({ query: { unread: 'true' } });
    const res = makeRes();
    await handler(req, res, makeNext());

    const queryCmd = mockSend.mock.calls[0][0];
    expect(queryCmd.input.FilterExpression).toBe('attribute_not_exists(readAt)');
  });

  it('returns empty array when no notifications exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: undefined });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    expect(res.json).toHaveBeenCalledWith({
      notifications: [],
      unreadCount: 0,
    });
  });

  it('passes DynamoDB errors to next()', async () => {
    mockSend.mockRejectedValueOnce(new Error('DB fail'));

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── PATCH /notifications/:id/read ───────────────────────────

describe('PATCH /notifications/:id/read', () => {
  const handler = getHandler('patch', '/:id/read');

  it('sets readAt and returns success for owned notification', async () => {
    mockSend.mockResolvedValueOnce({});

    const req = makeReq({ params: { id: 'n1' } });
    const res = makeRes();
    await handler(req, res, makeNext());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Marked as read', id: 'n1' }),
    );
  });

  it('returns NotFoundError on ConditionalCheckFailedException', async () => {
    const err = new Error('Condition not met');
    err.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(err);

    const req = makeReq({ params: { id: 'n1' } });
    const res = makeRes();
    const next = makeNext();
    await handler(req, res, next);

    expect(next).toHaveBeenCalled();
    const passedErr = next.mock.calls[0][0];
    expect(passedErr.name).toBe('NotFoundError');
  });
});

// ── POST /notifications/read-all ────────────────────────────

describe('POST /notifications/read-all', () => {
  const handler = getHandler('post', '/read-all');

  it('queries unread and updates each with readAt', async () => {
    // Query returns 2 unread notifications
    mockSend.mockResolvedValueOnce({
      Items: [{ id: 'n1' }, { id: 'n2' }],
    });
    // 2 UpdateCommand calls
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 }),
    );
    // 1 query + 2 updates = 3 calls
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('returns count: 0 when no unread notifications', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ count: 0 }),
    );
  });

  it('passes errors to next()', async () => {
    mockSend.mockRejectedValueOnce(new Error('DB fail'));

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── PATCH /notifications/:id/dismiss ────────────────────────

describe('PATCH /notifications/:id/dismiss', () => {
  const handler = getHandler('patch', '/:id/dismiss');

  it('sets dismissedAt and readAt and returns success', async () => {
    mockSend.mockResolvedValueOnce({});

    const req = makeReq({ params: { id: 'n1' } });
    const res = makeRes();
    await handler(req, res, makeNext());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Dismissed', id: 'n1' }),
    );

    // Verify UpdateCommand sets both dismissedAt and readAt
    const updateCmd = mockSend.mock.calls[0][0];
    expect(updateCmd.input.UpdateExpression).toContain('dismissedAt');
    expect(updateCmd.input.UpdateExpression).toContain('readAt');
  });

  it('returns NotFoundError on ConditionalCheckFailedException', async () => {
    const err = new Error('Condition not met');
    err.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(err);

    const req = makeReq({ params: { id: 'n1' } });
    const res = makeRes();
    const next = makeNext();
    await handler(req, res, next);

    const passedErr = next.mock.calls[0][0];
    expect(passedErr.name).toBe('NotFoundError');
  });

  it('passes generic errors to next()', async () => {
    const err = new Error('unexpected failure');
    mockSend.mockRejectedValueOnce(err);

    const req = makeReq({ params: { id: 'n1' } });
    const res = makeRes();
    const next = makeNext();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── GET /notifications/preferences ──────────────────────────

describe('GET /notifications/preferences', () => {
  // This is a parameterized route so we need to find by path prefix
  const handler = getHandler('get', '/preferences');

  it('returns stored preferences merged with DEFAULT_EVENTS', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        events: { workflow_failed: { inApp: false, email: true } },
      }],
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    const prefs = res.json.mock.calls[0][0].preferences;
    // Saved value preserved
    expect(prefs.events.workflow_failed).toEqual({ inApp: false, email: true });
    // Default value for new event type present
    expect(prefs.events.workflow_launched).toEqual({ inApp: true, email: false });
  });

  it('returns default events when no stored preferences exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    const prefs = res.json.mock.calls[0][0].preferences;
    expect(prefs.events.workflow_failed).toEqual({ inApp: true, email: true });
    expect(prefs.events.workflow_launched).toEqual({ inApp: true, email: false });
  });

  it('new event types appear even for existing records', async () => {
    // Existing record has only old events, missing execution_quota_exceeded
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        events: { workflow_failed: { inApp: true, email: true } },
      }],
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    const prefs = res.json.mock.calls[0][0].preferences;
    expect(prefs.events.execution_quota_exceeded).toEqual({ inApp: true, email: true });
  });

  it('passes DynamoDB errors to next()', async () => {
    mockSend.mockRejectedValueOnce(new Error('DB fail'));

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── PUT /notifications/preferences ──────────────────────────

describe('PUT /notifications/preferences', () => {
  const handler = getHandler('put', '/preferences');

  it('creates new record with uuid when no existing preference', async () => {
    // Query returns empty (no existing prefs)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // PutCommand succeeds
    mockSend.mockResolvedValueOnce({});

    const req = makeReq({
      body: { events: { workflow_failed: { inApp: true, email: false, slack: false } } },
    });
    const res = makeRes();
    await handler(req, res, makeNext());

    expect(res.json).toHaveBeenCalledWith({ message: 'Preferences updated' });
    // Put call should have id, userId, orgId
    const putCmd = mockSend.mock.calls[1][0];
    expect(putCmd.input.Item.userId).toBe('user-1');
    expect(putCmd.input.Item.orgId).toBe('org-1');
    expect(putCmd.input.Item.id).toBeDefined();
    expect(putCmd.input.Item.updatedAt).toBeDefined();
  });

  it('reuses existing id for upsert when record exists', async () => {
    // Query returns existing record
    mockSend.mockResolvedValueOnce({
      Items: [{ id: 'existing-pref-id', userId: 'user-1' }],
    });
    // PutCommand
    mockSend.mockResolvedValueOnce({});

    const req = makeReq({ body: { events: {} } });
    const res = makeRes();
    await handler(req, res, makeNext());

    const putCmd = mockSend.mock.calls[1][0];
    expect(putCmd.input.Item.id).toBe('existing-pref-id');
  });

  it('passes errors to next()', async () => {
    mockSend.mockRejectedValueOnce(new Error('DB fail'));

    const req = makeReq({ body: {} });
    const res = makeRes();
    const next = makeNext();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
