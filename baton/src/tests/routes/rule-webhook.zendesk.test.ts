/**
 * Per-Rule Webhook Route — Zendesk (hmac_zendesk) Tests — Baton
 *
 * Automations created in the flow builder get a per-rule webhook URL
 * (/api/webhooks/rule/:webhookKey), handled by routes/webhooks/rule.ts — which
 * has its OWN verification switch, separate from the catalog-app route. These
 * tests cover the `hmac_zendesk` branch added there.
 *
 * Zendesk signs `timestamp + rawBody` with HMAC-SHA256 (base64), sending the
 * signature in X-Zendesk-Webhook-Signature and the signed timestamp in
 * X-Zendesk-Webhook-Signature-Timestamp.
 */
import * as crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const {
  mockSend,
  mockStoreWebhookEvent,
  mockSendMessage,
  mockDecryptToken,
  mockGetAppTemplate,
} = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockStoreWebhookEvent: vi.fn(),
  mockSendMessage: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockGetAppTemplate: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));
vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: (cmd: any) => mockSend(cmd) }),
  TableNames: { AUTOMATION_RULES: 'baton-automation-rules', ORG_APPS: 'baton-org-apps' },
}));
vi.mock('../../lib/app-catalog', () => ({ getAppTemplate: mockGetAppTemplate }));
vi.mock('../../lib/encryption', () => ({ decryptToken: mockDecryptToken }));
vi.mock('../../lib/sf-registration-key', () => ({
  resolveSfRegistration: vi.fn(() => undefined),
  sfRegKey: vi.fn(() => 'sf-key'),
}));
vi.mock('../../services/webhook-event.service', () => ({ storeWebhookEvent: mockStoreWebhookEvent }));
vi.mock('../../queue/sqs-client', () => ({
  sendMessage: mockSendMessage,
  QueueNames: { WEBHOOK_PROCESSING: 'baton-webhook-processing' },
}));

import ruleWebhookRouter from '../../routes/webhooks/rule';

const SECRET = 'zendesk-signing-secret-32-chars-or-more';
const WEBHOOK_KEY = 'r'.repeat(64);
const ORG_ID = 'org-z';
const APP_ID = 'app-z';
const RULE_ID = 'rule-z';

const zendeskTemplate = { name: 'Zendesk', verificationMethod: { type: 'hmac_zendesk' } };

function rule() {
  return {
    id: RULE_ID, orgId: ORG_ID, sourcePlatform: 'zendesk', appSlug: 'zendesk',
    appId: APP_ID, status: 'active', webhookKey: WEBHOOK_KEY,
  };
}
function orgApp() {
  return { id: APP_ID, orgId: ORG_ID, appSlug: 'zendesk', secretKeyEnc: 'enc:iv:tag:ct', status: 'active' };
}

/** Route DynamoDB commands: QueryCommand→rule lookup, GetCommand→OrgApp, UpdateCommand→stats. */
function defaultSend(cmd: any) {
  if (cmd instanceof QueryCommand) return Promise.resolve({ Items: [rule()] });
  if (cmd instanceof GetCommand) return Promise.resolve({ Item: orgApp() });
  if (cmd instanceof UpdateCommand) return Promise.resolve({});
  return Promise.resolve({});
}

function signZendesk(body: Buffer, timestamp: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(timestamp + body.toString('utf8')).digest('base64');
}

function makeReq(body: object, headers: Record<string, string>): Request {
  return {
    body: Buffer.from(JSON.stringify(body)),
    headers,
    params: { webhookKey: WEBHOOK_KEY },
    requestId: 'req-rz-1',
  } as unknown as Request;
}

function makeRes(): Response & { _status?: number; _body?: any } {
  const res: any = {};
  res.status = vi.fn((code: number) => { res._status = code; return res; });
  res.json = vi.fn((data: any) => { res._body = data; return res; });
  res.get = vi.fn(() => undefined);
  res.headersSent = false;
  return res;
}

function getHandler() {
  const layers = (ruleWebhookRouter as any).stack as any[];
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
  mockStoreWebhookEvent.mockResolvedValue({ id: 'evt-rz-1' });
  mockGetAppTemplate.mockReturnValue(zendeskTemplate);
  mockSend.mockImplementation(defaultSend);
});

describe('POST /api/webhooks/rule/:webhookKey — hmac_zendesk', () => {
  it('accepts a valid Zendesk signature and enqueues with the ruleId', async () => {
    const body = { type: 'zen:event-type:ticket.created', detail: { id: '35436' } };
    const timestamp = new Date().toISOString();
    const sig = signZendesk(Buffer.from(JSON.stringify(body)), timestamp, SECRET);

    const res = makeRes();
    await getHandler()(makeReq(body, {
      'x-zendesk-webhook-signature': sig,
      'x-zendesk-webhook-signature-timestamp': timestamp,
    }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true, eventId: 'evt-rz-1' });

    await flushImmediate();
    expect(mockStoreWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'zendesk', connectionId: APP_ID, signatureValid: true }),
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      'baton-webhook-processing',
      expect.objectContaining({ eventId: 'evt-rz-1', platform: 'zendesk', orgId: ORG_ID, ruleId: RULE_ID }),
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

  it('rejects when signature headers are missing', async () => {
    const res = makeRes();
    await getHandler()(makeReq({ a: 1 }, {}), res);

    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/Missing Zendesk signature headers/i);
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects when the timestamp header is missing', async () => {
    const body = { a: 1 };
    const sig = signZendesk(Buffer.from(JSON.stringify(body)), '', SECRET);

    const res = makeRes();
    await getHandler()(makeReq(body, { 'x-zendesk-webhook-signature': sig }), res);

    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/Missing Zendesk signature headers/i);
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
