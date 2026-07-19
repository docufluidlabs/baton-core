/**
 * Webhook Handler Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { createWebhookHandler } from '../../routes/webhooks/handler';

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

const { mockStoreWebhookEvent, mockSendMessage, mockGetConnector, mockHasConnector, mockDdbSend } = vi.hoisted(() => ({
  mockStoreWebhookEvent: vi.fn(),
  mockSendMessage: vi.fn(),
  mockGetConnector: vi.fn(),
  mockHasConnector: vi.fn(),
  mockDdbSend: vi.fn(),
}));

vi.mock('../../services/webhook-event.service', () => ({
  storeWebhookEvent: mockStoreWebhookEvent,
}));

vi.mock('../../queue/sqs-client', () => ({
  sendMessage: mockSendMessage,
  QueueNames: { WEBHOOK_PROCESSING: 'webhook-proc' },
}));

vi.mock('../../services/connectors', () => ({
  getConnector: mockGetConnector,
  hasConnector: mockHasConnector,
}));

// Post-response work writes a TriggerPipelineEntry via the doc client.
vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: mockDdbSend }),
  TableNames: { TRIGGER_PIPELINE: 'baton-trigger-pipeline' },
}));

vi.mock('../../services/notification.service', () => ({
  sendNotification: vi.fn(),
  webhookFailedNotification: vi.fn(),
}));

vi.mock('../../services/user.service', () => ({
  getOrgAdmins: vi.fn(async () => []),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockDdbSend.mockResolvedValue({});
});

afterEach(async () => {
  // Drain any post-response setImmediate work scheduled by the handler so it
  // cannot leak into the next test's mock call records.
  await flushImmediate();
});

/** Flush all setImmediate callbacks (post-response async work) */
async function flushImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ─── Helpers ──────────────────────────────────────────────────

function mockReq(body: Record<string, any>, headers: Record<string, string> = {}): Request {
  return {
    body: Buffer.from(JSON.stringify(body)),
    headers,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode?: number; body?: any } {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

// ─── Tests ───────────────────────────────────────────────────

describe('createWebhookHandler', () => {
  const defaultOptions = {
    platform: 'xero' as const,
    getSecret: () => 'test-secret',
  };

  it('returns 400 for invalid JSON body', async () => {
    const handler = createWebhookHandler(defaultOptions);
    const req = { body: Buffer.from('not json'), headers: {} } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await handler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid JSON' });
  });

  it('returns 401 when signature verification fails', async () => {
    mockHasConnector.mockReturnValue(true);
    mockGetConnector.mockReturnValue({
      verifyWebhookSignature: vi.fn(() => ({ valid: false, reason: 'Bad sig' })),
    });

    const handler = createWebhookHandler(defaultOptions);
    const req = mockReq({ test: true });
    const res = mockRes();

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
  });

  it('stores event and returns 200 with eventId on valid signature', async () => {
    mockHasConnector.mockReturnValue(true);
    mockGetConnector.mockReturnValue({
      verifyWebhookSignature: vi.fn(() => ({ valid: true })),
    });
    mockStoreWebhookEvent.mockResolvedValue({ id: 'evt-1' });

    const handler = createWebhookHandler(defaultOptions);
    const req = mockReq({ data: 'hello' });
    const res = mockRes();

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true, eventId: 'evt-1' });
    expect(mockStoreWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'xero',
        signatureValid: true,
      }),
    );
  });

  it('enqueues SQS job when resolveConnection provides context', async () => {
    mockHasConnector.mockReturnValue(true);
    mockGetConnector.mockReturnValue({
      verifyWebhookSignature: vi.fn(() => ({ valid: true })),
    });
    mockStoreWebhookEvent.mockResolvedValue({ id: 'evt-2' });
    mockSendMessage.mockResolvedValue({});

    const handler = createWebhookHandler({
      ...defaultOptions,
      resolveConnection: async () => ({ orgId: 'org-1', connectionId: 'conn-1' }),
    });

    const req = mockReq({ data: 'test' });
    const res = mockRes();

    await handler(req, res, vi.fn());

    // The SQS enqueue happens in post-response setImmediate work
    await flushImmediate();

    expect(mockSendMessage).toHaveBeenCalledWith(
      'webhook-proc',
      expect.objectContaining({
        eventId: 'evt-2',
        platform: 'xero',
        orgId: 'org-1',
        connectionId: 'conn-1',
      }),
    );
  });

  it('does not enqueue when resolveConnection returns null', async () => {
    mockHasConnector.mockReturnValue(true);
    mockGetConnector.mockReturnValue({
      verifyWebhookSignature: vi.fn(() => ({ valid: true })),
    });
    mockStoreWebhookEvent.mockResolvedValue({ id: 'evt-3' });

    const handler = createWebhookHandler({
      ...defaultOptions,
      resolveConnection: async () => null,
    });

    await handler(mockReq({ data: 'x' }), mockRes(), vi.fn());

    // Even after the post-response work completes, nothing must be enqueued
    await flushImmediate();

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 500 when secret is empty (hard-fail: secret not configured)', async () => {
    // After the security fix: an empty secret must be rejected immediately.
    // This prevents silently accepting webhooks when a secret is misconfigured.
    const handler = createWebhookHandler({
      platform: 'xero' as const,
      getSecret: () => '',
    });

    const res = mockRes();
    await handler(mockReq({ data: 'x' }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Webhook secret not configured' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  it('returns 401 when a secret exists but no connector can verify it (fail closed)', async () => {
    mockHasConnector.mockReturnValue(false);

    const handler = createWebhookHandler(defaultOptions);
    const res = mockRes();

    await handler(mockReq({ data: 'x' }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Signature verification unavailable' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 200 even on internal errors (prevents platform retries)', async () => {
    mockHasConnector.mockReturnValue(true);
    mockGetConnector.mockReturnValue({
      verifyWebhookSignature: vi.fn(() => ({ valid: true })),
    });
    mockStoreWebhookEvent.mockRejectedValue(new Error('DDB error'));

    const handler = createWebhookHandler(defaultOptions);
    const res = mockRes();

    await handler(mockReq({ data: 'x' }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true, error: 'Processing error' });
  });
});
