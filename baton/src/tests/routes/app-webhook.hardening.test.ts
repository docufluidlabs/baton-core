/**
 * App Webhook Route — hardening — Baton
 *
 * Behaviour the per-app URL (/api/webhooks/app/:webhookKey) must share with
 * the per-automation URL: fail closed on a verification method it does not
 * implement, require every header a signature covers, refuse a body that is
 * not raw bytes, and keep credentials out of logs and stored events.
 */
import * as crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';

const {
  mockQuery,
  mockUpdate,
  mockStoreWebhookEvent,
  mockSendMessage,
  mockDecryptToken,
  mockGetAppTemplate,
  mockLogWarn,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockUpdate: vi.fn(),
  mockStoreWebhookEvent: vi.fn(),
  mockSendMessage: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockGetAppTemplate: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: mockLogWarn, logDebug: vi.fn(),
}));
vi.mock('../../db/client', () => ({
  getDocClient: () => ({
    send: (cmd: any) =>
      cmd?.constructor?.name === 'UpdateCommand' ? mockUpdate(cmd) : mockQuery(cmd),
  }),
  TableNames: { ORG_APPS: 'baton-org-apps' },
}));
vi.mock('../../lib/app-catalog', () => ({ getAppTemplate: mockGetAppTemplate }));
vi.mock('../../lib/encryption', () => ({ decryptToken: mockDecryptToken }));
vi.mock('../../services/webhook-event.service', () => ({ storeWebhookEvent: mockStoreWebhookEvent }));
vi.mock('../../queue/sqs-client', () => ({
  sendMessage: mockSendMessage,
  QueueNames: { WEBHOOK_PROCESSING: 'baton-webhook-processing' },
}));

import appWebhookRouter from '../../routes/webhooks/app';

const SECRET = 'test-secret-key-32-chars-or-more';
const WEBHOOK_KEY = 'c'.repeat(64);

function app(appSlug: string) {
  return {
    id: 'app-h', orgId: 'org-h', appSlug, webhookKey: WEBHOOK_KEY,
    secretKeyEnc: 'enc:iv:tag:ct', status: 'active',
  };
}

function makeReq(
  body: unknown,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): Request {
  const all: Record<string, string> = { 'content-type': 'application/json', ...headers };
  return {
    body,
    headers: all,
    params: { webhookKey: WEBHOOK_KEY },
    requestId: 'req-h-1',
    protocol: 'https',
    originalUrl: `/api/webhooks/app/${WEBHOOK_KEY}`,
    get: (name: string) => all[name.toLowerCase()],
    ...extra,
  } as unknown as Request;
}

function makeRes(): Response & { _status?: number; _body?: any } {
  const res: any = {};
  res.status = vi.fn((code: number) => { res._status = code; return res; });
  res.json = vi.fn((data: any) => { res._body = data; return res; });
  res.headersSent = false;
  return res;
}

function getHandler() {
  const layers = (appWebhookRouter as any).stack as any[];
  const layer = layers.find((l: any) => l.route?.methods?.post);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  return async (req: Request, res: Response) => {
    for (const fn of handlers) await fn(req, res, () => {});
  };
}

const flushImmediate = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();
  mockDecryptToken.mockReturnValue(SECRET);
  mockUpdate.mockResolvedValue({});
  mockSendMessage.mockResolvedValue('msg-id');
  mockStoreWebhookEvent.mockResolvedValue({ id: 'evt-h-1' });
});

afterEach(async () => {
  await flushImmediate();
});

describe('POST /api/webhooks/app/:webhookKey — unknown verification method', () => {
  it('rejects instead of accepting the request unverified', async () => {
    mockQuery.mockResolvedValue({ Items: [app('future')] });
    mockGetAppTemplate.mockReturnValue({ name: 'Future', verificationMethod: { type: 'hmac_future' } });

    const res = makeRes();
    await getHandler()(makeReq(Buffer.from('{"event":"x"}')), res);
    await flushImmediate();

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'Unsupported verification method' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('still accepts a template that declares no verification', async () => {
    mockQuery.mockResolvedValue({ Items: [app('mondaycom')] });
    mockGetAppTemplate.mockReturnValue({ name: 'monday.com', verificationMethod: { type: 'none' } });

    const res = makeRes();
    await getHandler()(makeReq(Buffer.from('{"event":"item.created"}')), res);

    expect(res._status).toBe(200);
    expect(mockStoreWebhookEvent).toHaveBeenCalledOnce();
  });
});

describe('POST /api/webhooks/app/:webhookKey — BambooHR', () => {
  const template = { name: 'BambooHR', verificationMethod: { type: 'hmac_bamboohr' } };
  const body = Buffer.from('{"employees":[{"id":"7"}]}');
  const sign = (timestamp: string) =>
    crypto.createHmac('sha256', SECRET).update(body.toString('utf8') + timestamp).digest('hex');

  beforeEach(() => {
    mockQuery.mockResolvedValue({ Items: [app('bamboohr')] });
    mockGetAppTemplate.mockReturnValue(template);
  });

  it('accepts a signature over body + timestamp', async () => {
    const res = makeRes();
    await getHandler()(
      makeReq(body, { 'x-bamboohr-signature': sign('1700000000'), 'x-bamboohr-timestamp': '1700000000' }),
      res,
    );

    expect(res._status).toBe(200);
  });

  it('requires the timestamp header, as the per-automation URL does', async () => {
    const res = makeRes();
    await getHandler()(makeReq(body, { 'x-bamboohr-signature': sign('') }), res);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Missing x-bamboohr-timestamp header' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/app/:webhookKey — request body', () => {
  beforeEach(() => {
    mockQuery.mockResolvedValue({ Items: [app('mondaycom')] });
    mockGetAppTemplate.mockReturnValue({ name: 'monday.com', verificationMethod: { type: 'none' } });
  });

  it('refuses a body that did not arrive as raw bytes', async () => {
    const res = makeRes();
    await getHandler()(makeReq({ already: 'parsed' }), res);

    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'Invalid request body' });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  it('reads a form post as fields', async () => {
    const res = makeRes();
    await getHandler()(
      makeReq(Buffer.from('event=item.created&recordId=42'), {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      }),
      res,
    );

    expect(res._status).toBe(200);
    expect(mockStoreWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { event: 'item.created', recordId: '42' } }),
    );
  });
});

describe('POST /api/webhooks/app/:webhookKey — credentials in stored events', () => {
  it('names the static token header so the event store masks it', async () => {
    mockQuery.mockResolvedValue({ Items: [app('airtable')] });
    mockGetAppTemplate.mockReturnValue({
      name: 'Airtable',
      verificationMethod: { type: 'static_token', headerName: 'X-Shared-Value' },
    });

    const res = makeRes();
    await getHandler()(makeReq(Buffer.from('{"event":"record.created"}'), { 'x-shared-value': SECRET }), res);

    expect(res._status).toBe(200);
    expect(mockStoreWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ credentialHeaders: ['X-Shared-Value'] }),
    );
  });
});

describe('POST /api/webhooks/app/:webhookKey — HubSpot failure log', () => {
  it('logs neither the expected signature nor credentials from the URL', async () => {
    mockQuery.mockResolvedValue({ Items: [app('hubspot')] });
    mockGetAppTemplate.mockReturnValue({
      name: 'HubSpot',
      verificationMethod: { type: 'hmac_hubspot_v3', headerName: 'x-hubspot-signature-v3' },
    });

    const body = Buffer.from('[{"eventId":1}]');
    const timestamp = String(Date.now());
    const url = `/api/webhooks/app/${WEBHOOK_KEY}?token=url-borne-secret`;
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update('POST' + `https://baton.example.com${url}` + body.toString('utf8') + timestamp, 'utf8')
      .digest('base64');

    const res = makeRes();
    await getHandler()(
      makeReq(
        body,
        {
          host: 'baton.example.com',
          'x-hubspot-signature-v3': 'not-the-signature',
          'x-hubspot-request-timestamp': timestamp,
        },
        { originalUrl: url },
      ),
      res,
    );

    expect(res._status).toBe(401);
    const logged = JSON.stringify(mockLogWarn.mock.calls);
    expect(logged).not.toContain(expected);
    expect(logged).not.toContain('url-borne-secret');
  });
});
