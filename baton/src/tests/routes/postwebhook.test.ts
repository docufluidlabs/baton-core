/**
 * Postwebhook Receiver Tests — Baton
 *
 * POST /api/postwebhook/:orgId/:endpointId answers 200 as soon as the event is
 * stored and does the rest (pipeline entry, queue send, stats) afterwards,
 * inside the same try block. These tests pin what happens when that later
 * work fails, and how the endpoint's API key is checked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const { mockSend, mockStoreWebhookEvent, mockSendMessage, mockLogError, mockLogWarn } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockStoreWebhookEvent: vi.fn(),
  mockSendMessage: vi.fn(),
  mockLogError: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(), logError: mockLogError, logWarn: mockLogWarn, logDebug: vi.fn(),
}));
vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: (cmd: any) => mockSend(cmd) }),
  TableNames: {
    WEBHOOK_ENDPOINTS: 'baton-webhook-endpoints',
    TRIGGER_PIPELINE: 'baton-trigger-pipeline',
  },
}));
vi.mock('../../services/webhook-event.service', () => ({ storeWebhookEvent: mockStoreWebhookEvent }));
vi.mock('../../queue/sqs-client', () => ({
  sendMessage: mockSendMessage,
  QueueNames: { WORKFLOW_LAUNCHER: 'baton-workflow-launcher' },
}));

import postwebhookRouter from '../../routes/webhooks/postwebhook';

const ORG_ID = 'org-p';
const API_KEY = 'endpoint-api-key-0123456789abcdef';
let endpointSeq = 0;

/** A fresh endpoint id per test: the route keeps a per-endpoint rate counter in memory. */
function endpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: `ep-${++endpointSeq}`,
    orgId: ORG_ID,
    name: 'Orders',
    platform: 'custom',
    workflowId: 'wf-1',
    payloadFieldPath: 'order.id',
    rateLimitPerMinute: 60,
    enabled: true,
    requestCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function serve(ep: ReturnType<typeof endpoint>, failOn?: 'put' | 'update') {
  mockSend.mockImplementation((cmd: any) => {
    if (cmd instanceof GetCommand) return Promise.resolve({ Item: ep });
    if (cmd instanceof PutCommand) {
      return failOn === 'put' ? Promise.reject(new Error('pipeline write failed')) : Promise.resolve({});
    }
    if (cmd instanceof UpdateCommand) {
      return failOn === 'update' ? Promise.reject(new Error('stats write failed')) : Promise.resolve({});
    }
    return Promise.resolve({});
  });
}

function makeReq(ep: { id: string }, body: unknown, headers: Record<string, string> = {}): Request {
  return {
    body,
    headers: { 'content-type': 'application/json', ...headers },
    params: { orgId: ORG_ID, endpointId: ep.id },
    requestId: 'req-p-1',
  } as unknown as Request;
}

/** A response that behaves like Express: a second send throws ERR_HTTP_HEADERS_SENT. */
function makeRes(): Response & { _status?: number; _body?: any; sends: number } {
  const res: any = { headersSent: false, sends: 0 };
  res.status = vi.fn((code: number) => { res._pending = code; return res; });
  res.json = vi.fn((data: any) => {
    if (res.headersSent) {
      const err: any = new Error('Cannot set headers after they are sent to the client');
      err.code = 'ERR_HTTP_HEADERS_SENT';
      throw err;
    }
    res.headersSent = true;
    res.sends += 1;
    res._status = res._pending;
    res._body = data;
    return res;
  });
  return res;
}

function getHandler() {
  const layers = (postwebhookRouter as any).stack as any[];
  const layer = layers.find((l: any) => l.route?.methods?.post);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  return async (req: Request, res: Response) => {
    for (const fn of handlers) await fn(req, res, () => {});
  };
}

const body = (payload: object) => Buffer.from(JSON.stringify(payload));

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreWebhookEvent.mockResolvedValue({ id: 'evt-p-1' });
  mockSendMessage.mockResolvedValue('msg-id');
});

describe('POST /api/postwebhook/:orgId/:endpointId', () => {
  it('stores the event, answers 200 and queues the workflow launch', async () => {
    const ep = endpoint();
    serve(ep);
    const res = makeRes();

    await getHandler()(makeReq(ep, body({ order: { id: 'ORD-7' } })), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true, eventId: 'evt-p-1' });
    expect(mockSendMessage).toHaveBeenCalledWith(
      'baton-workflow-launcher',
      expect.objectContaining({
        ruleId: `endpoint:${ep.id}`,
        workflowId: 'wf-1',
        orgId: ORG_ID,
        inputData: { order: { id: 'ORD-7' }, _recordId: 'ORD-7' },
      }),
    );
  });

  describe('when work after the response fails', () => {
    it.each([
      ['the pipeline entry write', () => serve(endpoint(), 'put')],
      ['the endpoint stats write', () => serve(endpoint(), 'update')],
      ['the queue send', () => { serve(endpoint()); mockSendMessage.mockRejectedValue(new Error('queue down')); }],
    ])('does not answer twice when %s fails', async (_what, arrange) => {
      arrange();
      const res = makeRes();

      await expect(
        getHandler()(makeReq({ id: `ep-${endpointSeq}` }, body({ order: { id: 'ORD-8' } })), res),
      ).resolves.toBeUndefined();

      expect(res.sends).toBe(1);
      expect(res._status).toBe(200);
      expect(res._body).toEqual({ received: true, eventId: 'evt-p-1' });
      expect(mockLogError).toHaveBeenCalledWith(
        'Postwebhook handler error',
        expect.any(Error),
        expect.objectContaining({ orgId: ORG_ID }),
      );
    });
  });

  it('still answers 200 with an error note when the failure comes before the response', async () => {
    const ep = endpoint();
    serve(ep);
    mockStoreWebhookEvent.mockRejectedValue(new Error('store failed'));
    const res = makeRes();

    await getHandler()(makeReq(ep, body({ order: { id: 'ORD-9' } })), res);

    expect(res.sends).toBe(1);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true, error: 'Processing error' });
  });

  it('skips the post-response work for a duplicate delivery', async () => {
    const ep = endpoint();
    serve(ep);
    mockStoreWebhookEvent.mockResolvedValue({ id: 'duplicate' });
    const res = makeRes();

    await getHandler()(makeReq(ep, body({ order: { id: 'ORD-7' } })), res);

    expect(res._status).toBe(200);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('refuses a body that did not arrive as raw bytes', async () => {
    const ep = endpoint();
    serve(ep);
    const res = makeRes();

    await getHandler()(makeReq(ep, { order: { id: 'ORD-7' } }), res);

    expect(res._status).toBe(400);
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('answers 404 for an endpoint of another organization', async () => {
    const ep = endpoint({ orgId: 'someone-else' });
    serve(ep);
    const res = makeRes();

    await getHandler()(makeReq(ep, body({})), res);

    expect(res._status).toBe(404);
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  describe('API key', () => {
    it('accepts the configured key', async () => {
      const ep = endpoint({ apiKey: API_KEY });
      serve(ep);
      const res = makeRes();

      await getHandler()(makeReq(ep, body({ order: { id: '1' } }), { 'x-api-key': API_KEY }), res);

      expect(res._status).toBe(200);
    });

    it.each([
      ['a missing key', {}],
      ['a wrong key of the same length', { 'x-api-key': API_KEY.slice(0, -1) + 'X' }],
      ['a prefix of the key', { 'x-api-key': API_KEY.slice(0, 8) }],
      ['the key with extra characters', { 'x-api-key': API_KEY + 'extra' }],
    ])('rejects %s', async (_what, headers) => {
      const ep = endpoint({ apiKey: API_KEY });
      serve(ep);
      const res = makeRes();

      await getHandler()(makeReq(ep, body({ order: { id: '1' } }), headers as Record<string, string>), res);

      expect(res._status).toBe(401);
      expect(res._body).toEqual({ error: 'Invalid or missing API key' });
      expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
    });

    it('does not log the key that was tried', async () => {
      const ep = endpoint({ apiKey: API_KEY });
      serve(ep);

      await getHandler()(makeReq(ep, body({}), { 'x-api-key': 'a-guessed-key-value' }), makeRes());

      expect(JSON.stringify(mockLogWarn.mock.calls)).not.toContain('a-guessed-key-value');
    });
  });
});
