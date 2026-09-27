/**
 * Per-Rule Webhook Route — Basic Auth and body handling — Baton
 *
 * The per-automation URL (/api/webhooks/rule/:webhookKey) is the one the Flow
 * Builder shows and users paste into Zoho CRM or Power Automate. It checks the
 * Basic auth credentials those setup guides have the user configure, exactly
 * as the per-app URL does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const {
  mockSend,
  mockStoreWebhookEvent,
  mockSendMessage,
  mockDecryptToken,
  mockGetAppTemplate,
  mockLogWarn,
} = vi.hoisted(() => ({
  mockSend: vi.fn(),
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

const USERNAME = 'baton-zoho';
const PASSWORD = 'a-long-random-password';
const WEBHOOK_KEY = 'b'.repeat(64);
const ORG_ID = 'org-b';
const APP_ID = 'app-b';
const RULE_ID = 'rule-b';

const basicAuthTemplate = { name: 'Zoho CRM', verificationMethod: { type: 'basic_auth' } };

function rule() {
  return {
    id: RULE_ID, orgId: ORG_ID, sourcePlatform: 'zohocrm', appSlug: 'zohocrm',
    appId: APP_ID, status: 'active', webhookKey: WEBHOOK_KEY,
  };
}
function orgApp() {
  return { id: APP_ID, orgId: ORG_ID, appSlug: 'zohocrm', secretKeyEnc: 'enc:iv:tag:ct', status: 'active' };
}

function defaultSend(cmd: any) {
  if (cmd instanceof QueryCommand) return Promise.resolve({ Items: [rule()] });
  if (cmd instanceof GetCommand) return Promise.resolve({ Item: orgApp() });
  if (cmd instanceof UpdateCommand) return Promise.resolve({});
  return Promise.resolve({});
}

const basic = (username: string, password: string) =>
  'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return {
    body,
    headers: { 'content-type': 'application/json', ...headers },
    params: { webhookKey: WEBHOOK_KEY },
    requestId: 'req-rb-1',
    get: () => undefined,
  } as unknown as Request;
}

const jsonBody = (payload: object) => Buffer.from(JSON.stringify(payload));

function makeRes(): Response & { _status?: number; _body?: any } {
  const res: any = {};
  res.status = vi.fn((code: number) => { res._status = code; return res; });
  res.json = vi.fn((data: any) => { res._body = data; return res; });
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
  mockSend.mockImplementation(defaultSend);
  mockDecryptToken.mockReturnValue(`${USERNAME}:${PASSWORD}`);
  mockGetAppTemplate.mockReturnValue(basicAuthTemplate);
  mockStoreWebhookEvent.mockResolvedValue({ id: 'evt-b-1' });
  mockSendMessage.mockResolvedValue('msg-id');
});

afterEach(async () => {
  await flushImmediate();
});

describe('POST /api/webhooks/rule/:webhookKey — basic_auth', () => {
  it('accepts the configured credentials and queues only this rule', async () => {
    const res = makeRes();
    await getHandler()(
      makeReq(jsonBody({ module: 'Deals', operation: 'insert' }), { authorization: basic(USERNAME, PASSWORD) }),
      res,
    );
    await flushImmediate();

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true, eventId: 'evt-b-1' });
    expect(mockSendMessage).toHaveBeenCalledWith(
      'baton-webhook-processing',
      expect.objectContaining({ eventId: 'evt-b-1', ruleId: RULE_ID, orgId: ORG_ID }),
    );
  });

  it('rejects a request with no Authorization header', async () => {
    const res = makeRes();
    await getHandler()(makeReq(jsonBody({ module: 'Deals' })), res);
    await flushImmediate();

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Missing Authorization header' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects a wrong password', async () => {
    const res = makeRes();
    await getHandler()(
      makeReq(jsonBody({ module: 'Deals' }), { authorization: basic(USERNAME, 'not-the-password') }),
      res,
    );
    await flushImmediate();

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Invalid credentials' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects a wrong username', async () => {
    const res = makeRes();
    await getHandler()(
      makeReq(jsonBody({ module: 'Deals' }), { authorization: basic('someone-else', PASSWORD) }),
      res,
    );

    expect(res._status).toBe(401);
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects another authorization scheme', async () => {
    const res = makeRes();
    await getHandler()(
      makeReq(jsonBody({ module: 'Deals' }), { authorization: `Bearer ${PASSWORD}` }),
      res,
    );

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Invalid authorization scheme' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  it('answers 500 when the stored secret is not username:password', async () => {
    mockDecryptToken.mockReturnValue('a-bare-token');
    const res = makeRes();
    await getHandler()(
      makeReq(jsonBody({ module: 'Deals' }), { authorization: basic(USERNAME, PASSWORD) }),
      res,
    );

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'Internal configuration error' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  it('never writes the credentials to the log', async () => {
    const res = makeRes();
    await getHandler()(
      makeReq(jsonBody({ module: 'Deals' }), { authorization: basic(USERNAME, 'guess-1') }),
      res,
    );

    const logged = JSON.stringify(mockLogWarn.mock.calls);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain('guess-1');
    expect(logged).not.toContain(Buffer.from(`${USERNAME}:guess-1`).toString('base64'));
  });
});

describe('POST /api/webhooks/rule/:webhookKey — templates without a check', () => {
  it('still accepts a `none` template without credentials', async () => {
    mockGetAppTemplate.mockReturnValue({ name: 'monday.com', verificationMethod: { type: 'none' } });
    const res = makeRes();
    await getHandler()(makeReq(jsonBody({ event: 'item.created' })), res);
    await flushImmediate();

    expect(res._status).toBe(200);
    expect(mockStoreWebhookEvent).toHaveBeenCalledOnce();
  });

  it('fails closed on a verification type it does not implement', async () => {
    mockGetAppTemplate.mockReturnValue({ name: 'Future', verificationMethod: { type: 'hmac_future' } });
    const res = makeRes();
    await getHandler()(makeReq(jsonBody({ event: 'x' })), res);

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'Unsupported verification method' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/rule/:webhookKey — request body', () => {
  it('refuses a body that did not arrive as raw bytes', async () => {
    const res = makeRes();
    // What the route would see if express.raw() had not captured the request.
    await getHandler()(
      makeReq({ module: 'Deals' }, { authorization: basic(USERNAME, PASSWORD) }),
      res,
    );

    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'Invalid request body' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  it('reads a form post as fields, not as "[object Object]"', async () => {
    const res = makeRes();
    await getHandler()(
      makeReq(Buffer.from('module=Deals&operation=insert&ids=101%2C102'), {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic(USERNAME, PASSWORD),
      }),
      res,
    );
    await flushImmediate();

    expect(res._status).toBe(200);
    expect(mockStoreWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { module: 'Deals', operation: 'insert', ids: '101,102' } }),
    );
  });
});
