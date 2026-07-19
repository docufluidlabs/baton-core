/**
 * Tests for POST /instances/:id/report — ClickUp task creation
 * Verifies: message format (Context first, Timeline with duration, IDs with backticks,
 * Input section conditional, footer with userId).
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

vi.mock('../../env', () => ({
  default: {
    SUPPORT_TICKET_TOKEN: 'test-token',
    SUPPORT_TICKET_LIST_ID: 'list-123',
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Import router after mocks ──────────────────────────────

import instancesRouter from '../../routes/instances';

// ─── Test helpers ────────────────────────────────────────────

function makeReq(overrides: any = {}): Request {
  return {
    auth: { userId: 'dev-user-1', orgId: 'org-1' },
    params: { id: 'instance-1' },
    query: {},
    body: { title: 'Workflow stopped', description: 'Contact lookup failed' },
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

const handler = getHandler('post', '/:id/report');

// ─── Fixtures ────────────────────────────────────────────────

const fakeInstance = {
  id: '79253832-330c-4588-890c-7d780e7e25fa',
  orgId: 'org-1',
  workflowId: 'wf-1',
  instanceName: 'Test — 4, 5, 6',
  status: 'failed',
  errorMessage: 'Connection timeout after 30s',
  errorStep: 'Step 2 — Lookup Contact',
  maestroInstanceId: 'maestro-abc-123',
  triggerRuleId: 'rule-1',
  startedAt: '2026-04-07T10:00:00.000Z',
  completedAt: '2026-04-07T10:00:24.000Z',  // 24s later
  retryCount: 3,
  retryMaxAttempts: 6,
  inputData: { firstName: 'Alex', email: 'alex@example.com' },
};

/** Extracts the description string from the fetch call body */
function getCapturedDescription(): string {
  const fetchCallBody = JSON.parse(mockFetch.mock.calls[0][1].body);
  return fetchCallBody.description;
}

function getCapturedTaskName(): string {
  const fetchCallBody = JSON.parse(mockFetch.mock.calls[0][1].body);
  return fetchCallBody.name;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue({ Item: fakeInstance });
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'task-1', url: 'https://app.support.example.com/t/task-1' }),
  });
});

// ─── Tests ──────────────────────────────────────────────────

describe('POST /instances/:id/report — message format', () => {
  it('returns 400 when instance is not failed', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...fakeInstance, status: 'running' } });

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('places Context section first when user description provided', async () => {
    const req = makeReq({ body: { title: 'Bug', description: 'Something went wrong' } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    const desc = getCapturedDescription();
    const contextIdx = desc.indexOf('## Context');
    const errorIdx = desc.indexOf('## Error');
    expect(contextIdx).toBeGreaterThanOrEqual(0);
    expect(contextIdx).toBeLessThan(errorIdx);
  });

  it('includes user description in Context block', async () => {
    const req = makeReq({ body: { title: 'Bug', description: 'workflow was broken' } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getCapturedDescription()).toContain('> workflow was broken');
  });

  it('omits Context section when no description provided', async () => {
    const req = makeReq({ body: { title: 'Bug', description: '' } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getCapturedDescription()).not.toContain('## Context');
  });

  it('includes Error section with instance errorMessage', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    const desc = getCapturedDescription();
    expect(desc).toContain('## Error');
    expect(desc).toContain('Connection timeout after 30s');
  });

  it('includes Timeline section with formatted Started date', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    const desc = getCapturedDescription();
    expect(desc).toContain('## Timeline');
    expect(desc).toContain('**Started:**');
    // Should contain "Apr" or "07" — some human-readable date format, not raw ISO
    expect(desc).not.toContain('**Started:** 2026-04-07T10:00:00.000Z');
  });

  it('includes Duration in Timeline', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    const desc = getCapturedDescription();
    expect(desc).toContain('**Duration:** 24s');
  });

  it('includes Retries count in Timeline', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    const desc = getCapturedDescription();
    expect(desc).toContain('**Retries:** 3 / 6');
  });

  it('includes IDs section with backtick-formatted instance ID', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    const desc = getCapturedDescription();
    expect(desc).toContain('## IDs');
    expect(desc).toContain('`79253832-330c-4588-890c-7d780e7e25fa`');
  });

  it('includes backtick-formatted Maestro ID in IDs section', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getCapturedDescription()).toContain('`maestro-abc-123`');
  });

  it('includes Input section with JSON when inputData present', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    const desc = getCapturedDescription();
    expect(desc).toContain('## Input');
    expect(desc).toContain('"firstName"');
    expect(desc).toContain('"alex@example.com"');
  });

  it('omits Input section when no inputData', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...fakeInstance, inputData: undefined } });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getCapturedDescription()).not.toContain('## Input');
  });

  it('omits Input section when inputData is empty object', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...fakeInstance, inputData: {} } });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getCapturedDescription()).not.toContain('## Input');
  });

  it('footer includes reported-by userId', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getCapturedDescription()).toContain('Reported by dev-user-1');
  });

  it('footer includes Auto-generated by Baton', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getCapturedDescription()).toContain('Auto-generated by Baton');
  });

  it('task name uses [Baton] prefix with user title', async () => {
    const req = makeReq({ body: { title: 'My custom bug report', description: '' } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getCapturedTaskName()).toBe('[Baton] My custom bug report');
  });

  it('task name falls back to instance name when no title provided', async () => {
    const req = makeReq({ body: { title: '', description: '' } });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(getCapturedTaskName()).toContain('[Baton]');
    expect(getCapturedTaskName()).toContain('Test — 4, 5, 6');
  });
});
