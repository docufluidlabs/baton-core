/**
 * Per-Rule Webhook Route — Salesforce secret-downgrade guard — Baton
 *
 * Regression suite for a verification downgrade in routes/webhooks/rule.ts.
 *
 * The route picks which secret to verify against by looking for the
 * `X-Baton-Sf-Org-Id` header. Inside that branch a missing registration
 * correctly 401s (so the Apex package's auto-heal re-registers). But a request
 * that omitted the header entirely fell through to the app-level legacy
 * `secretKeyEnc` — the human-chosen shared secret admins paste in during setup.
 *
 * So an attacker who knew that shared secret could bypass per-org registration
 * completely by dropping one header, and forge signed events for any rule of
 * the app. The managed package has sent the header on every dispatch since
 * v0.3, so its absence on an app that has registrations is never legitimate.
 *
 * Guard: header-less requests are rejected once `sfRegistrations` is non-empty.
 * Apps with no registrations (every non-Salesforce platform, and Salesforce
 * installs still on the legacy shared secret) keep the fallback.
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
  mockResolveSfRegistration,
} = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockStoreWebhookEvent: vi.fn(),
  mockSendMessage: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockGetAppTemplate: vi.fn(),
  mockResolveSfRegistration: vi.fn(),
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
  resolveSfRegistration: (...args: unknown[]) => mockResolveSfRegistration(...args),
  sfRegKey: (orgId: string, key: string) => `${orgId}#${key}`,
}));
vi.mock('../../services/webhook-event.service', () => ({ storeWebhookEvent: mockStoreWebhookEvent }));
vi.mock('../../queue/sqs-client', () => ({
  sendMessage: mockSendMessage,
  QueueNames: { WEBHOOK_PROCESSING: 'baton-webhook-processing' },
}));

import ruleWebhookRouter from '../../routes/webhooks/rule';

const LEGACY_SECRET = 'legacy-app-level-shared-secret-value';
const PER_ORG_SECRET = 'per-org-registered-secret-from-apex';
const WEBHOOK_KEY = 's'.repeat(64);
const SF_ORG = '00DC3000003B7ndMAC';
const ORG_ID = 'org-s';
const APP_ID = 'app-s';

const sfTemplate = {
  name: 'Salesforce',
  verificationMethod: { type: 'hmac_sha256', headerName: 'x-salesforce-signature', encoding: 'base64' },
};

function rule() {
  return {
    id: 'rule-s', orgId: ORG_ID, sourcePlatform: 'salesforce', appSlug: 'salesforce',
    appId: APP_ID, status: 'active', webhookKey: WEBHOOK_KEY,
  };
}

/** `registrations` mirrors OrgApp.sfRegistrations — undefined means "never registered". */
function orgApp(registrations?: Record<string, unknown>) {
  return {
    id: APP_ID, orgId: ORG_ID, appSlug: 'salesforce', status: 'active',
    secretKeyEnc: 'enc:legacy', sfRegistrations: registrations,
  };
}

function sendWith(app: ReturnType<typeof orgApp>) {
  return (cmd: any) => {
    if (cmd instanceof QueryCommand) return Promise.resolve({ Items: [rule()] });
    if (cmd instanceof GetCommand) return Promise.resolve({ Item: app });
    if (cmd instanceof UpdateCommand) return Promise.resolve({});
    return Promise.resolve({});
  };
}

function signSalesforce(body: Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

function makeReq(body: object, headers: Record<string, string>): Request {
  return {
    body: Buffer.from(JSON.stringify(body)),
    headers,
    params: { webhookKey: WEBHOOK_KEY },
    requestId: 'req-sf-1',
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
  mockSendMessage.mockResolvedValue('msg-id');
  mockStoreWebhookEvent.mockResolvedValue({ id: 'evt-sf-1' });
  mockGetAppTemplate.mockReturnValue(sfTemplate);
  mockResolveSfRegistration.mockReturnValue(undefined);
});

describe('POST /api/webhooks/rule/:webhookKey — Salesforce secret-downgrade guard', () => {
  it('rejects a header-less request once the app has per-org registrations, even with a valid legacy signature', async () => {
    // The attacker knows the legacy shared secret and signs correctly with it.
    mockSend.mockImplementation(sendWith(orgApp({ [`${SF_ORG}#${WEBHOOK_KEY}`]: { secretKeyEnc: 'enc:perorg' } })));
    mockDecryptToken.mockReturnValue(LEGACY_SECRET);

    const body = { objectType: 'opportunity', action: 'updated', recordId: '006xx' };
    const res = makeRes();
    await getHandler()(makeReq(body, {
      'x-salesforce-signature': signSalesforce(Buffer.from(JSON.stringify(body)), LEGACY_SECRET),
    }), res);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Missing X-Baton-Sf-Org-Id header' });

    await flushImmediate();
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('still accepts the legacy shared secret when the app has no registrations yet', async () => {
    mockSend.mockImplementation(sendWith(orgApp(undefined)));
    mockDecryptToken.mockReturnValue(LEGACY_SECRET);

    const body = { objectType: 'opportunity', action: 'created', recordId: '006yy' };
    const res = makeRes();
    await getHandler()(makeReq(body, {
      'x-salesforce-signature': signSalesforce(Buffer.from(JSON.stringify(body)), LEGACY_SECRET),
    }), res);

    expect(res._status).toBe(200);
    await flushImmediate();
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it('treats an empty registrations map as "no registrations" and keeps the fallback', async () => {
    mockSend.mockImplementation(sendWith(orgApp({})));
    mockDecryptToken.mockReturnValue(LEGACY_SECRET);

    const body = { objectType: 'lead', action: 'created', recordId: '00Qzz' };
    const res = makeRes();
    await getHandler()(makeReq(body, {
      'x-salesforce-signature': signSalesforce(Buffer.from(JSON.stringify(body)), LEGACY_SECRET),
    }), res);

    expect(res._status).toBe(200);
  });

  it('accepts a registered org that sends the header and signs with its per-org secret', async () => {
    mockSend.mockImplementation(sendWith(orgApp({ [`${SF_ORG}#${WEBHOOK_KEY}`]: { secretKeyEnc: 'enc:perorg' } })));
    mockResolveSfRegistration.mockReturnValue({
      key: `${SF_ORG}#${WEBHOOK_KEY}`, isLegacy: false, entry: { secretKeyEnc: 'enc:perorg' },
    });
    mockDecryptToken.mockReturnValue(PER_ORG_SECRET);

    const body = { objectType: 'opportunity', action: 'updated', recordId: '006aa' };
    const res = makeRes();
    await getHandler()(makeReq(body, {
      'x-baton-sf-org-id': SF_ORG,
      'x-salesforce-signature': signSalesforce(Buffer.from(JSON.stringify(body)), PER_ORG_SECRET),
    }), res);

    expect(res._status).toBe(200);
    await flushImmediate();
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it('rejects a registered org that signs with the legacy secret instead of its own', async () => {
    mockSend.mockImplementation(sendWith(orgApp({ [`${SF_ORG}#${WEBHOOK_KEY}`]: { secretKeyEnc: 'enc:perorg' } })));
    mockResolveSfRegistration.mockReturnValue({
      key: `${SF_ORG}#${WEBHOOK_KEY}`, isLegacy: false, entry: { secretKeyEnc: 'enc:perorg' },
    });
    mockDecryptToken.mockReturnValue(PER_ORG_SECRET);

    const body = { objectType: 'opportunity', action: 'updated', recordId: '006bb' };
    const res = makeRes();
    await getHandler()(makeReq(body, {
      'x-baton-sf-org-id': SF_ORG,
      'x-salesforce-signature': signSalesforce(Buffer.from(JSON.stringify(body)), LEGACY_SECRET),
    }), res);

    expect(res._status).toBe(401);
  });
});
