/**
 * Tests for GET /automations/:id/actions
 * Verifies: data joining (webhook events + instances), status derivation, auth checks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// ─── Mocks ──────────────────────────────────────────────────

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: {
    TRIGGER_PIPELINE: 'baton-trigger-pipeline',
    WEBHOOK_EVENTS: 'baton-webhook-events',
    WORKFLOW_INSTANCES: 'baton-workflow-instances',
  },
}));

const mockGetRule = vi.fn();
vi.mock('../../services/rule-engine.service', () => ({
  getRule: (...args: any[]) => mockGetRule(...args),
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
      this.name = 'NotFoundError';
    }
  },
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

// ─── Import router after mocks ──────────────────────────────

import automationsRouter from '../../routes/rules';

// ─── Test helpers ────────────────────────────────────────────

function makeReq(overrides: any = {}): Request {
  return {
    auth: { userId: 'user-1', orgId: 'org-1' },
    params: { id: 'rule-1' },
    query: {},
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

function getHandler(method: string, path: string) {
  const layer = (automationsRouter as any).stack.find((l: any) => {
    if (!l.route) return false;
    return l.route.path === path && l.route.methods[method];
  });
  if (!layer) throw new Error(`No handler found for ${method} ${path}`);
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

const handler = getHandler('get', '/:id/actions');

// ─── Fixtures ────────────────────────────────────────────────

const fakeRule = { id: 'rule-1', orgId: 'org-1', status: 'active', name: 'Test Rule' };

const fakePipelineEntry = {
  id: 'pipeline-1',
  ruleId: 'rule-1',
  orgId: 'org-1',
  eventType: 'rule_match',
  triggeredAt: '2026-04-07T10:00:00.000Z',
  status: 'completed',
  actionNumber: 1,
  webhookEventId: 'webhook-1',
  workflowInstanceId: 'instance-1',
  rawPayload: { event: 'contact.created' },
};

const fakeWebhookEvent = {
  id: 'webhook-1',
  platform: 'hubspot',
  signatureValid: true,
  payload: { event: 'contact.created' },
  receivedAt: '2026-04-07T09:59:00.000Z',
  processed: true,
};

const fakeInstance = {
  id: 'instance-1',
  orgId: 'org-1',
  workflowId: 'workflow-1',
  maestroInstanceId: 'maestro-inst-1',
  status: 'completed',
  retryCount: 0,
  retryMaxAttempts: null,
  nextRetryAt: null,
  errorMessage: null,
  inputData: { name: 'Test' },
};

beforeEach(() => {
  mockSend.mockReset();         // clears mockResolvedValueOnce queue
  mockGetRule.mockReset();
  mockGetRule.mockResolvedValue(fakeRule);
});

// ─── Tests ──────────────────────────────────────────────────

describe('GET /automations/:id/actions', () => {
  it('returns 404 when rule not found', async () => {
    mockGetRule.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('returns 404 when rule belongs to different org', async () => {
    mockGetRule.mockResolvedValue({ ...fakeRule, orgId: 'other-org' });

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('returns empty actions array when no pipeline entries', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    expect(res.json).toHaveBeenCalledWith({ actions: [] });
  });

  it('returns correctly shaped ActionItem — status=launched when instance exists', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [fakePipelineEntry] })             // Query: pipeline entries
      .mockResolvedValueOnce({ Responses: { 'baton-webhook-events': [fakeWebhookEvent] } })  // BatchGet: webhooks
      .mockResolvedValueOnce({ Responses: { 'baton-workflow-instances': [fakeInstance] } });  // BatchGet: instances

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    expect(res.json).toHaveBeenCalledWith({
      actions: [expect.objectContaining({
        actionNumber: 1,
        pipelineEntryId: 'pipeline-1',
        webhookEventId: 'webhook-1',
        triggeredAt: '2026-04-07T10:00:00.000Z',
        status: 'launched',
        signatureValid: true,
        payload: { event: 'contact.created' },
        instance: expect.objectContaining({
          id: 'instance-1',
          maestroInstanceId: 'maestro-inst-1',
          status: 'completed',
          retryCount: 0,
        }),
      })],
    });
  });

  it('sets status=failed when signatureValid is false', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [fakePipelineEntry] })
      .mockResolvedValueOnce({ Responses: { 'baton-webhook-events': [{ ...fakeWebhookEvent, signatureValid: false }] } })
      .mockResolvedValueOnce({ Responses: { 'baton-workflow-instances': [fakeInstance] } });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    const [{ actions }] = res.json.mock.calls[0];
    expect(actions[0].status).toBe('failed');
  });

  it('sets status=running when no instance exists yet', async () => {
    const entryWithoutInstance = { ...fakePipelineEntry, workflowInstanceId: undefined };
    // No instances BatchGet — workflowInstanceId is absent so instanceIds is empty
    mockSend
      .mockResolvedValueOnce({ Items: [entryWithoutInstance] })
      .mockResolvedValueOnce({ Responses: { 'baton-webhook-events': [fakeWebhookEvent] } });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    const [{ actions }] = res.json.mock.calls[0];
    expect(actions[0].status).toBe('running');
    expect(actions[0].instance).toBeNull();
  });

  it('sets status=launched when instance exists, regardless of instance.status', async () => {
    // Even if instance is failed, the Action successfully triggered it → launched
    mockSend
      .mockResolvedValueOnce({ Items: [fakePipelineEntry] })
      .mockResolvedValueOnce({ Responses: { 'baton-webhook-events': [fakeWebhookEvent] } })
      .mockResolvedValueOnce({ Responses: { 'baton-workflow-instances': [{ ...fakeInstance, status: 'failed' }] } });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    const [{ actions }] = res.json.mock.calls[0];
    expect(actions[0].status).toBe('launched');
    // Instance status is still available for Maestro stage display
    expect(actions[0].instance.status).toBe('failed');
  });

  it('sets status=launched when instance is running', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [fakePipelineEntry] })
      .mockResolvedValueOnce({ Responses: { 'baton-webhook-events': [fakeWebhookEvent] } })
      .mockResolvedValueOnce({ Responses: { 'baton-workflow-instances': [{ ...fakeInstance, status: 'running' }] } });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    const [{ actions }] = res.json.mock.calls[0];
    expect(actions[0].status).toBe('launched');
  });

  it('returns null webhookEventId when not set on pipeline entry', async () => {
    const entryNoWebhook = { ...fakePipelineEntry, webhookEventId: undefined };
    // No webhooks BatchGet — webhookEventId absent, so webhookIds is empty
    // Instance BatchGet IS called (workflowInstanceId is set)
    mockSend
      .mockResolvedValueOnce({ Items: [entryNoWebhook] })
      .mockResolvedValueOnce({ Responses: { 'baton-workflow-instances': [fakeInstance] } });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    const [{ actions }] = res.json.mock.calls[0];
    expect(actions[0].webhookEventId).toBeNull();
    expect(actions[0].signatureValid).toBeNull();
  });

  it('respects limit param, capped at 100', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = makeReq({ query: { limit: '200' } });
    const res = makeRes();
    await handler(req, res, makeNext());

    const queryCmd = mockSend.mock.calls[0][0];
    expect(queryCmd.input.Limit).toBeLessThanOrEqual(300); // overscan x3 of max 100
  });

  it('queries pipeline entries with ScanIndexForward false (newest first)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res, makeNext());

    const queryCmd = mockSend.mock.calls[0][0];
    expect(queryCmd.input.ScanIndexForward).toBe(false);
  });
});
