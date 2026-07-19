/**
 * App Webhook Route — Zendesk (hmac_zendesk) Tests — Baton
 *
 * Zendesk Event subscriptions sign `timestamp + rawBody` with HMAC-SHA256
 * (base64), sending the signature in X-Zendesk-Webhook-Signature and the signed
 * timestamp in X-Zendesk-Webhook-Signature-Timestamp. These tests verify the
 * `hmac_zendesk` branch added to routes/webhooks/app.ts.
 *
 * Kept in a separate file from app-webhook.test.ts so its mock state is fully
 * isolated.
 */
import * as crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

const {
  mockQuery,
  mockStoreWebhookEvent,
  mockSendMessage,
  mockDecryptToken,
  mockGetAppTemplate,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockStoreWebhookEvent: vi.fn(),
  mockSendMessage: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockGetAppTemplate: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));
vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: (cmd: any) => mockQuery(cmd) }),
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

const SECRET = 'zendesk-signing-secret-32-chars-or-more';
const WEBHOOK_KEY = 'z'.repeat(64);
const ORG_ID = 'org-z';
const APP_ID = 'app-z';

const zendeskTemplate = {
  name: 'Zendesk',
  verificationMethod: {
    type: 'hmac_zendesk',
    headerName: 'x-zendesk-webhook-signature',
    encoding: 'base64',
  },
};

function zendeskApp() {
  return {
    id: APP_ID, orgId: ORG_ID, appSlug: 'zendesk', webhookKey: WEBHOOK_KEY,
    secretKeyEnc: 'enc:iv:tag:ct', status: 'active', webhookCount: 0,
  };
}

function signZendesk(body: Buffer, timestamp: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(timestamp + body.toString('utf8')).digest('base64');
}

function makeReq(body: object, headers: Record<string, string>): Request {
  return {
    body: Buffer.from(JSON.stringify(body)),
    headers,
    params: { webhookKey: WEBHOOK_KEY },
    requestId: 'req-z-1',
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
  mockSendMessage.mockResolvedValue('msg-id');
  mockStoreWebhookEvent.mockResolvedValue({ id: 'evt-z-1' });
  mockQuery.mockResolvedValue({ Items: [zendeskApp()] });
  mockGetAppTemplate.mockReturnValue(zendeskTemplate);
});

describe('POST /api/webhooks/app/:webhookKey — hmac_zendesk', () => {
  it('accepts a valid Zendesk signature and enqueues for processing', async () => {
    const body = { type: 'zen:event-type:ticket.created', detail: { id: '35436' } };
    const timestamp = new Date().toISOString();
    const sig = signZendesk(Buffer.from(JSON.stringify(body)), timestamp, SECRET);

    const res = makeRes();
    await getHandler()(makeReq(body, {
      'x-zendesk-webhook-signature': sig,
      'x-zendesk-webhook-signature-timestamp': timestamp,
    }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true, eventId: 'evt-z-1' });

    await flushImmediate();
    expect(mockStoreWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'zendesk', connectionId: APP_ID, signatureValid: true }),
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      'baton-webhook-processing',
      expect.objectContaining({ eventId: 'evt-z-1', platform: 'zendesk', orgId: ORG_ID }),
    );
  });

  it('rejects a tampered body with 401', async () => {
    const timestamp = new Date().toISOString();
    const sig = signZendesk(Buffer.from(JSON.stringify({ a: 1 })), timestamp, SECRET);

    const res = makeRes();
    await getHandler()(makeReq({ a: 2 }, {
      'x-zendesk-webhook-signature': sig,
      'x-zendesk-webhook-signature-timestamp': timestamp,
    }), res);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Invalid signature' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects when the signature header is missing', async () => {
    const res = makeRes();
    await getHandler()(makeReq({ a: 1 }, {
      'x-zendesk-webhook-signature-timestamp': new Date().toISOString(),
    }), res);

    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/Missing x-zendesk-webhook-signature header/i);
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects when the timestamp header is missing', async () => {
    const body = { a: 1 };
    const sig = signZendesk(Buffer.from(JSON.stringify(body)), '', SECRET);

    const res = makeRes();
    await getHandler()(makeReq(body, { 'x-zendesk-webhook-signature': sig }), res);

    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/timestamp/i);
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects a stale timestamp (replay protection)', async () => {
    const body = { a: 1 };
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const sig = signZendesk(Buffer.from(JSON.stringify(body)), oldTimestamp, SECRET);

    const res = makeRes();
    await getHandler()(makeReq(body, {
      'x-zendesk-webhook-signature': sig,
      'x-zendesk-webhook-signature-timestamp': oldTimestamp,
    }), res);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Webhook timestamp too old' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });
});
