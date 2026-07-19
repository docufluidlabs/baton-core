/**
 * App Webhook Route Tests — Baton
 *
 * Covers all cases described in section 7 of the design doc:
 *  1. valid HMAC → 200 + event stored + SQS enqueued
 *  2. invalid HMAC → 401 + nothing stored
 *  3. missing signature header → 401
 *  4. unknown webhookKey → 404
 *  5. inactive app → 403
 *  6. duplicate platformEventId → 200 idempotent (no SQS)
 *  7. static_token verification (Zoho pattern)
 *  8. HMAC prefix stripping (HubSpot sha256= prefix)
 *  9. missing secretKeyEnc → 500
 * 10. invalid JSON body → 400
 */
import * as crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// ─── Hoisted mocks ────────────────────────────────────────────

const {
  mockQuery,
  mockUpdate,
  mockStoreWebhookEvent,
  mockSendMessage,
  mockDecryptToken,
  mockGetAppTemplate,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockUpdate: vi.fn(),
  mockStoreWebhookEvent: vi.fn(),
  mockSendMessage: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockGetAppTemplate: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: (cmd: any) => mockQuery(cmd) }),
  TableNames: { ORG_APPS: 'baton-org-apps' },
}));

vi.mock('../../lib/app-catalog', () => ({
  getAppTemplate: mockGetAppTemplate,
}));

vi.mock('../../lib/encryption', () => ({
  decryptToken: mockDecryptToken,
}));

vi.mock('../../services/webhook-event.service', () => ({
  storeWebhookEvent: mockStoreWebhookEvent,
}));

vi.mock('../../queue/sqs-client', () => ({
  sendMessage: mockSendMessage,
  QueueNames: { WEBHOOK_PROCESSING: 'baton-webhook-processing' },
}));

// ─── Import handler AFTER mocks ──────────────────────────────

import appWebhookRouter from '../../routes/webhooks/app';

// ─── Helpers ─────────────────────────────────────────────────

const SECRET = 'test-secret-key-32-chars-or-more';
const WEBHOOK_KEY = 'a'.repeat(64);
const ORG_ID = 'org-123';
const APP_ID = 'app-456';

function buildHmacHex(body: Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function buildHmacBase64(body: Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

function makeReq(
  body: object | string,
  headers: Record<string, string> = {},
  params: Record<string, string> = { webhookKey: WEBHOOK_KEY },
): Request {
  const rawBody = typeof body === 'string'
    ? Buffer.from(body)
    : Buffer.from(JSON.stringify(body));
  return {
    body: rawBody,
    headers,
    params,
    requestId: 'req-test-1',
  } as unknown as Request;
}

function makeRes(): Response & { _status?: number; _body?: any } {
  const res: any = { _status: undefined, _body: undefined };
  res.status = vi.fn((code: number) => { res._status = code; return res; });
  res.json = vi.fn((data: any) => { res._body = data; return res; });
  res.headersSent = false;
  return res;
}

/** App fixture with hmac_sha256 verification */
function activeHmacApp(overrides: Partial<any> = {}) {
  return {
    id: APP_ID,
    orgId: ORG_ID,
    appSlug: 'procore',
    webhookKey: WEBHOOK_KEY,
    secretKeyEnc: 'enc:iv:tag:ct',
    status: 'active',
    webhookCount: 5,
    ...overrides,
  };
}

/** AppTemplate fixture for HMAC hex (Procore) */
const hmacHexTemplate = {
  name: 'Procore',
  verificationMethod: {
    type: 'hmac_sha256',
    headerName: 'x-procore-signature',
    encoding: 'hex',
  },
};

/** AppTemplate fixture for HMAC base64 with prefix (HubSpot) */
const hmacBase64PrefixTemplate = {
  name: 'HubSpot',
  verificationMethod: {
    type: 'hmac_sha256',
    headerName: 'x-hub-signature-256',
    encoding: 'base64',
    prefix: 'sha256=',
  },
};

/** AppTemplate fixture for static token (Zoho) */
const staticTokenTemplate = {
  name: 'Zoho CRM',
  verificationMethod: {
    type: 'static_token',
    headerName: 'x-zoho-webhook-token',
    encoding: 'hex',
  },
};

/** AppTemplate fixture for Basic Auth */
const basicAuthTemplate = {
  name: 'Zoho CRM',
  verificationMethod: {
    type: 'basic_auth',
  },
};

function buildBasicAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

// ─── Shared setup ─────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockDecryptToken.mockReturnValue(SECRET);
  mockUpdate.mockResolvedValue({});
  mockSendMessage.mockResolvedValue('msg-id');
  mockStoreWebhookEvent.mockResolvedValue({ id: 'evt-001' });
});

// ─── Tests ───────────────────────────────────────────────────

describe('POST /api/webhooks/app/:webhookKey', () => {

  // ── 4. Unknown webhookKey → 404 ──────────────────────────
  it('returns 404 for unknown webhookKey', async () => {
    mockQuery.mockResolvedValue({ Items: [] });

    const handler = getHandler();
    const res = makeRes();
    await handler(makeReq({ test: 1 }), res);

    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'Unknown endpoint' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  // ── 5. Inactive app → 403 ────────────────────────────────
  it('returns 403 for inactive app', async () => {
    mockQuery.mockResolvedValue({ Items: [activeHmacApp({ status: 'inactive' })] });

    const res = makeRes();
    await getHandler()(makeReq({ test: 1 }), res);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'App is inactive' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  // ── 10. Invalid JSON body → 400 ──────────────────────────
  it('returns 400 for invalid JSON body', async () => {
    mockQuery.mockResolvedValue({ Items: [activeHmacApp()] });
    mockGetAppTemplate.mockReturnValue(hmacHexTemplate);

    const res = makeRes();
    const req = {
      body: Buffer.from('not-valid-json'),
      headers: {},
      params: { webhookKey: WEBHOOK_KEY },
      requestId: 'r1',
    } as unknown as Request;

    await getHandler()(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'Invalid JSON' });
  });

  // ── 9. Missing secretKeyEnc → 500 ────────────────────────
  it('returns 500 when app has no secretKeyEnc', async () => {
    const appNoSecret = activeHmacApp({ secretKeyEnc: undefined });
    mockQuery.mockResolvedValue({ Items: [appNoSecret] });
    mockGetAppTemplate.mockReturnValue(hmacHexTemplate);

    const res = makeRes();
    await getHandler()(makeReq({ x: 1 }), res);

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'Webhook secret not configured for this app' });
  });

  // ── 3. Missing signature header → 401 ───────────────────
  it('returns 401 when signature header is absent (hmac_sha256)', async () => {
    mockQuery.mockResolvedValue({ Items: [activeHmacApp()] });
    mockGetAppTemplate.mockReturnValue(hmacHexTemplate);

    const res = makeRes();
    await getHandler()(makeReq({ x: 1 }, {}), res); // no headers

    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/Missing x-procore-signature/i);
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  // ── 2. Invalid HMAC → 401 ────────────────────────────────
  it('returns 401 for wrong HMAC signature', async () => {
    mockQuery.mockResolvedValue({ Items: [activeHmacApp()] });
    mockGetAppTemplate.mockReturnValue(hmacHexTemplate);

    const body = { deal: 123 };
    const wrongSig = 'deadbeef'.repeat(8); // 64 hex chars but wrong value

    const res = makeRes();
    await getHandler()(makeReq(body, { 'x-procore-signature': wrongSig }), res);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Invalid signature' });
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  // ── 1. Valid HMAC → 200 + stored + enqueued ──────────────
  it('returns 200 and enqueues SQS job for valid HMAC-SHA256 (hex)', async () => {
    mockQuery.mockResolvedValue({ Items: [activeHmacApp()] });
    mockGetAppTemplate.mockReturnValue(hmacHexTemplate);

    const body = { event: 'vendors.create', id: 99 };
    const rawBody = Buffer.from(JSON.stringify(body));
    const sig = buildHmacHex(rawBody, SECRET);

    const res = makeRes();
    const req = makeReq(body, { 'x-procore-signature': sig });
    await getHandler()(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true, eventId: 'evt-001' });

    // Give setImmediate a chance to run
    await flushImmediate();

    expect(mockStoreWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'procore',
        connectionId: APP_ID,
        signatureValid: true,
      }),
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      'baton-webhook-processing',
      expect.objectContaining({
        eventId: 'evt-001',
        platform: 'procore',
        orgId: ORG_ID,
        connectionId: APP_ID,
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          UpdateExpression: expect.stringContaining('ADD webhookCount'),
        }),
      }),
    );
  });

  // ── 8. HMAC with prefix stripping (HubSpot sha256=) ─────
  it('strips sha256= prefix before comparing HMAC (HubSpot pattern)', async () => {
    const hubspotApp = activeHmacApp({ appSlug: 'hubspot' });
    mockQuery.mockResolvedValue({ Items: [hubspotApp] });
    mockGetAppTemplate.mockReturnValue(hmacBase64PrefixTemplate);

    const body = { subscriptionType: 'contact.creation', objectId: 42 };
    const rawBody = Buffer.from(JSON.stringify(body));
    const sig = 'sha256=' + buildHmacBase64(rawBody, SECRET);

    const res = makeRes();
    await getHandler()(makeReq(body, { 'x-hub-signature-256': sig }), res);

    expect(res._status).toBe(200);
    expect(mockStoreWebhookEvent).toHaveBeenCalled();
  });

  // ── 7. Static token verification (Zoho) ─────────────────
  it('verifies static_token for Zoho pattern', async () => {
    const zohoApp = activeHmacApp({ appSlug: 'zohocrm' });
    mockQuery.mockResolvedValue({ Items: [zohoApp] });
    mockGetAppTemplate.mockReturnValue(staticTokenTemplate);
    // decryptToken returns SECRET which is the stored token
    mockDecryptToken.mockReturnValue(SECRET);

    const body = { module: 'Deals', operation: 'insert', ids: ['12'] };
    const res = makeRes();

    await getHandler()(makeReq(body, { 'x-zoho-webhook-token': SECRET }), res);

    expect(res._status).toBe(200);
    expect(mockStoreWebhookEvent).toHaveBeenCalled();
  });

  it('returns 401 for wrong static_token', async () => {
    const zohoApp = activeHmacApp({ appSlug: 'zohocrm' });
    mockQuery.mockResolvedValue({ Items: [zohoApp] });
    mockGetAppTemplate.mockReturnValue(staticTokenTemplate);
    mockDecryptToken.mockReturnValue(SECRET);

    const body = { module: 'Deals', ids: ['1'] };
    const res = makeRes();

    await getHandler()(makeReq(body, { 'x-zoho-webhook-token': 'wrong-token' }), res);

    expect(res._status).toBe(401);
    expect(mockStoreWebhookEvent).not.toHaveBeenCalled();
  });

  // ── 6. Duplicate platformEventId → 200 idempotent ───────
  it('returns 200 but skips SQS enqueue for duplicate event', async () => {
    mockQuery.mockResolvedValue({ Items: [activeHmacApp()] });
    mockGetAppTemplate.mockReturnValue(hmacHexTemplate);
    // Idempotency guard: returns 'duplicate' stub
    mockStoreWebhookEvent.mockResolvedValue({ id: 'duplicate' });

    const body = { event: 'vendors.create', id: 99 };
    const rawBody = Buffer.from(JSON.stringify(body));
    const sig = buildHmacHex(rawBody, SECRET);

    const res = makeRes();
    await getHandler()(makeReq(body, { 'x-procore-signature': sig }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true, eventId: 'duplicate' });

    await flushImmediate();

    // SQS must NOT be called for duplicates
    expect(mockSendMessage).not.toHaveBeenCalled();
    // webhookCount must NOT be updated for duplicates
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── Decryption failure → 500 ─────────────────────────────
  it('returns 500 when decryptToken throws', async () => {
    mockQuery.mockResolvedValue({ Items: [activeHmacApp()] });
    mockGetAppTemplate.mockReturnValue(hmacHexTemplate);
    mockDecryptToken.mockImplementation(() => { throw new Error('bad key'); });

    const res = makeRes();
    await getHandler()(makeReq({ x: 1 }), res);

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'Internal configuration error' });
  });

  // ── No template for appSlug → 500 ────────────────────────
  it('returns 500 when no AppTemplate found for appSlug', async () => {
    mockQuery.mockResolvedValue({ Items: [activeHmacApp({ appSlug: 'unknown_slug' })] });
    mockGetAppTemplate.mockReturnValue(undefined); // catalog miss

    const res = makeRes();
    await getHandler()(makeReq({ x: 1 }), res);

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'App template not found' });
  });
});

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Extract the route handler from the express Router.
 * The router has a single POST route registered for '/:webhookKey'.
 */
function getHandler() {
  const layers = (appWebhookRouter as any).stack as any[];
  const layer = layers.find((l: any) => l.route?.methods?.post);
  const handlers = layer.route.stack.map((s: any) => s.handle);

  return async (req: Request, res: Response) => {
    for (const fn of handlers) {
      await fn(req, res, () => {});
    }
  };
}

/** Flush all setImmediate callbacks (post-response async work) */
async function flushImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
