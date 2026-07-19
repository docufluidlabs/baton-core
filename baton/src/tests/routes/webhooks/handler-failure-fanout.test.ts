/**
 * Tests for the webhook signature-failure notification fan-out in
 * routes/webhooks/handler.ts.
 *
 * When a webhook arrives with an invalid HMAC signature:
 *   1. Handler responds 401 immediately (hot path stays fast).
 *   2. Best-effort: resolves orgId from the unverified payload.
 *   3. If orgId is found, fans out a webhook_failed notification to every admin.
 *      Slack routes per-org (only the first admin's call leaves channels default).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────

vi.mock('../../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })),
  TableNames: { WEBHOOK_EVENTS: 'webhook-events' },
}));

vi.mock('../../../queue/sqs-client', () => ({
  sendMessage: vi.fn(),
  QueueNames: { WEBHOOK_PROCESSING: 'webhook-processing' },
}));

vi.mock('../../../services/webhook-event.service', () => ({
  storeWebhookEvent: vi.fn().mockResolvedValue({ id: 'event-1' }),
}));

const mockVerifyWebhookSignature: any = vi.fn();
const mockExtractEventInfo: any = vi.fn(() => ({ eventLabel: 'evt', summary: 'sum' }));

vi.mock('../../../services/connectors', () => ({
  hasConnector: () => true,
  getConnector: () => ({
    verifyWebhookSignature: (body: Buffer, headers: Record<string, string>, secret: string) =>
      mockVerifyWebhookSignature(body, headers, secret),
    extractEventInfo: (payload: any) => mockExtractEventInfo(payload),
  }),
}));

const mockSendNotification = vi.fn();
const mockWebhookFailedNotification = vi.fn(
  (orgId: string, recipientId: string, platform: string, reason: string) => ({
    type: 'webhook_failed', orgId, recipientId, platform, reason,
  }),
);
vi.mock('../../../services/notification.service', () => ({
  sendNotification: (...args: any[]) => mockSendNotification(...args),
  webhookFailedNotification: (...args: any[]) => mockWebhookFailedNotification(...args),
}));

const mockGetOrgAdmins = vi.fn();
vi.mock('../../../services/user.service', () => ({
  getOrgAdmins: (...args: any[]) => mockGetOrgAdmins(...args),
}));

vi.mock('../../../lib/logger', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { createWebhookHandler } from '../../../routes/webhooks/handler';

// ─── Helpers ─────────────────────────────────────────────────

function makeReq(body: Record<string, any>) {
  return {
    body: Buffer.from(JSON.stringify(body)),
    headers: { 'x-test-sig': 'bogus' },
  } as any;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

/** Wait for any setImmediate-scheduled work to drain. */
function flushSetImmediate() {
  return new Promise<void>((r) => setImmediate(r));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyWebhookSignature.mockReturnValue({ valid: false, reason: 'HMAC mismatch' });
});

// Drain any setImmediate callbacks queued by the handler so they don't leak
// into the next test and double-count notifications.
afterEach(async () => {
  await flushSetImmediate();
});

// ─── Tests ───────────────────────────────────────────────────

describe('webhook handler — signature-failure fan-out', () => {
  it('responds 401 immediately and does not block on the fan-out', async () => {
    mockGetOrgAdmins.mockResolvedValueOnce(['admin-1']);

    const handler = createWebhookHandler({
      platform: 'bamboohr',
      getSecret: () => 'secret',
      resolveConnection: async () => ({ orgId: 'org-1', connectionId: 'conn-1' }),
    });

    const req = makeReq({ companyDomain: 'acme' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
  });

  it('fans out a webhook_failed notification to every admin', async () => {
    mockGetOrgAdmins.mockResolvedValueOnce(['admin-1', 'admin-2', 'admin-3']);

    const handler = createWebhookHandler({
      platform: 'bamboohr',
      getSecret: () => 'secret',
      resolveConnection: async () => ({ orgId: 'org-1', connectionId: 'conn-1' }),
    });

    await handler(makeReq({ companyDomain: 'acme' }), makeRes(), vi.fn());
    await flushSetImmediate();

    expect(mockGetOrgAdmins).toHaveBeenCalledWith('org-1');
    expect(mockSendNotification).toHaveBeenCalledTimes(3);

    const recipients = mockSendNotification.mock.calls.map((c) => c[0].recipientId);
    expect(recipients).toEqual(['admin-1', 'admin-2', 'admin-3']);

    // Reason from the connector is propagated through to the notification
    expect(mockWebhookFailedNotification).toHaveBeenCalledWith(
      'org-1', 'admin-1', 'bamboohr', 'HMAC mismatch',
    );
  });

  it('routes Slack once: only the first recipient leaves channels default', async () => {
    mockGetOrgAdmins.mockResolvedValueOnce(['admin-1', 'admin-2']);

    const handler = createWebhookHandler({
      platform: 'bamboohr',
      getSecret: () => 'secret',
      resolveConnection: async () => ({ orgId: 'org-1' }),
    });

    await handler(makeReq({ companyDomain: 'acme' }), makeRes(), vi.fn());
    await flushSetImmediate();

    expect(mockSendNotification.mock.calls[0][0].channels).toBeUndefined();
    expect(mockSendNotification.mock.calls[1][0].channels).toEqual(['in_app', 'email']);
  });

  it('skips the notification when orgId cannot be resolved from the unverified payload', async () => {
    const handler = createWebhookHandler({
      platform: 'bamboohr',
      getSecret: () => 'secret',
      resolveConnection: async () => null,
    });

    await handler(makeReq({}), makeRes(), vi.fn());
    await flushSetImmediate();

    expect(mockGetOrgAdmins).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('skips the notification when the platform handler has no resolveConnection', async () => {
    const handler = createWebhookHandler({
      platform: 'bamboohr',
      getSecret: () => 'secret',
      // No resolveConnection — e.g. Stripe/Clerk style
    });

    await handler(makeReq({}), makeRes(), vi.fn());
    await flushSetImmediate();

    expect(mockGetOrgAdmins).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('skips the notification when the org has no admins', async () => {
    mockGetOrgAdmins.mockResolvedValueOnce([]);

    const handler = createWebhookHandler({
      platform: 'bamboohr',
      getSecret: () => 'secret',
      resolveConnection: async () => ({ orgId: 'org-1' }),
    });

    await handler(makeReq({ companyDomain: 'acme' }), makeRes(), vi.fn());
    await flushSetImmediate();

    expect(mockGetOrgAdmins).toHaveBeenCalledWith('org-1');
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('does not fire when the signature is valid', async () => {
    mockVerifyWebhookSignature.mockReturnValueOnce({ valid: true });

    const handler = createWebhookHandler({
      platform: 'bamboohr',
      getSecret: () => 'secret',
      resolveConnection: async () => ({ orgId: 'org-1', connectionId: 'conn-1' }),
    });

    await handler(makeReq({ companyDomain: 'acme' }), makeRes(), vi.fn());
    await flushSetImmediate();

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('passes a fallback reason when the connector did not supply one', async () => {
    mockVerifyWebhookSignature.mockReturnValueOnce({ valid: false }); // no reason
    mockGetOrgAdmins.mockResolvedValueOnce(['admin-1']);

    const handler = createWebhookHandler({
      platform: 'bamboohr',
      getSecret: () => 'secret',
      resolveConnection: async () => ({ orgId: 'org-1' }),
    });

    await handler(makeReq({ companyDomain: 'acme' }), makeRes(), vi.fn());
    await flushSetImmediate();

    expect(mockWebhookFailedNotification).toHaveBeenCalledWith(
      'org-1', 'admin-1', 'bamboohr', 'Invalid signature',
    );
  });
});
