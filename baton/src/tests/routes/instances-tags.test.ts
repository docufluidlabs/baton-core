/**
 * Tests for PUT /instances/:id/tags — org-shared instance tags.
 * Verifies: validation (array of strings, max count), normalization
 * (trim/dedupe/blank-drop/length-cap), org scoping, and the DynamoDB write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// ─── Mocks ──────────────────────────────────────────────────

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: { WORKFLOW_INSTANCES: 'baton-workflow-instances' },
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/rbac', () => ({
  requireViewer: (_req: any, _res: any, next: any) => next(),
  requireMember: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/error-handler', () => ({
  NotFoundError: class NotFoundError extends Error {
    statusCode = 404;
    constructor(resource: string) {
      super(`${resource} not found`);
    }
  },
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../env', () => ({ default: {} }));

// ─── Import router after mocks ──────────────────────────────

import instancesRouter from '../../routes/instances';

// ─── Test helpers ────────────────────────────────────────────

function makeReq(overrides: any = {}): Request {
  return {
    auth: { userId: 'dev-user-1', orgId: 'org-1' },
    params: { id: 'instance-1' },
    query: {},
    body: { tags: ['urgent'] },
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const res: any = {};
  res.json = vi.fn(() => res);
  res.status = vi.fn(() => res);
  return res as Response & { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };
}

function getHandler(method: string, path: string) {
  const layer = (instancesRouter as any).stack.find((l: any) => {
    if (!l.route) return false;
    return l.route.path === path && l.route.methods[method];
  });
  if (!layer) throw new Error(`No handler found for ${method} ${path}`);
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

const handler = getHandler('put', '/:id/tags');

const fakeInstance = {
  id: 'instance-1',
  orgId: 'org-1',
  workflowId: 'wf-1',
  instanceName: 'Test instance',
  status: 'completed',
};

/** The tags value passed to the UpdateCommand (last send call). */
function getWrittenTags(): string[] {
  const updateCall = mockSend.mock.calls.find(
    ([cmd]) => cmd?.input?.UpdateExpression?.includes('tags'),
  );
  return updateCall?.[0].input.ExpressionAttributeValues[':tags'];
}

beforeEach(() => {
  vi.clearAllMocks();
  // GET returns the instance, UpdateCommand resolves to nothing meaningful.
  mockSend.mockResolvedValue({ Item: fakeInstance });
});

// ─── Tests ──────────────────────────────────────────────────

describe('PUT /instances/:id/tags', () => {
  it('persists tags and echoes the stored list', async () => {
    const req = makeReq({ body: { tags: ['urgent', 'finance'] } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getWrittenTags()).toEqual(['urgent', 'finance']);
    expect(res.json).toHaveBeenCalledWith({ id: 'instance-1', tags: ['urgent', 'finance'] });
  });

  it('trims whitespace, drops blanks, and dedupes (order preserved)', async () => {
    const req = makeReq({ body: { tags: ['  urgent ', 'urgent', '', '   ', 'finance'] } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getWrittenTags()).toEqual(['urgent', 'finance']);
  });

  it('caps each tag at 30 characters', async () => {
    const long = 'x'.repeat(50);
    const req = makeReq({ body: { tags: [long] } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getWrittenTags()).toEqual(['x'.repeat(30)]);
  });

  it('allows an empty array (clears all tags)', async () => {
    const req = makeReq({ body: { tags: [] } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getWrittenTags()).toEqual([]);
    expect(res.json).toHaveBeenCalledWith({ id: 'instance-1', tags: [] });
  });

  it('returns 400 when tags is not an array', async () => {
    const req = makeReq({ body: { tags: 'urgent' } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getWrittenTags()).toBeUndefined();
  });

  it('returns 400 when tags contains a non-string', async () => {
    const req = makeReq({ body: { tags: ['ok', 5] } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getWrittenTags()).toBeUndefined();
  });

  it('returns 400 when more than 20 tags are provided', async () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    const req = makeReq({ body: { tags } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getWrittenTags()).toBeUndefined();
  });

  it('does not write when the instance belongs to another org (404)', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...fakeInstance, orgId: 'other-org' } });

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);

    // GET happened, but no UpdateCommand write.
    expect(getWrittenTags()).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});
