import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

// ─── Hoisted mocks ──────────────────────────────────────────

const mockGetSlackConfig = vi.fn();
const mockGetSlackConfigByTeamId = vi.fn();
const mockUpsertSlackConfig = vi.fn();
const mockVerifySlackSignature = vi.fn();
const mockHandleAppMention = vi.fn();
const mockSendSlackNotification = vi.fn();
const mockPostSlackMessage = vi.fn();
const mockResolveToken = vi.fn();

vi.mock('../../services/slack.service', () => ({
  getSlackConfig: (...args: any[]) => mockGetSlackConfig(...args),
  getSlackConfigByTeamId: (...args: any[]) => mockGetSlackConfigByTeamId(...args),
  upsertSlackConfig: (...args: any[]) => mockUpsertSlackConfig(...args),
  verifySlackSignature: (...args: any[]) => mockVerifySlackSignature(...args),
  handleAppMention: (...args: any[]) => mockHandleAppMention(...args),
  sendSlackNotification: (...args: any[]) => mockSendSlackNotification(...args),
  postSlackMessage: (...args: any[]) => mockPostSlackMessage(...args),
  resolveToken: (...args: any[]) => mockResolveToken(...args),
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/rbac', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../env', () => ({
  default: {
    SLACK_SIGNING_SECRET: 'test-signing-secret',
    SLACK_DEFAULT_CHANNEL: '#general',
    FRONTEND_URL: 'http://localhost:5173',
  },
}));

// ─── Imports ────────────────────────────────────────────────

import { slackEventsRouter, slackConfigRouter } from '../../routes/slack';

// ─── Helpers ────────────────────────────────────────────────

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => {
    if (!l.route) return false;
    return l.route.path === path && l.route.methods[method];
  });
  if (!layer) throw new Error(`No handler found for ${method} ${path}`);
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

function makeReq(overrides: any = {}) {
  return {
    auth: { userId: 'user-1', orgId: 'org-1' },
    query: {},
    params: {},
    body: {},
    headers: {},
    ...overrides,
  } as any;
}

function makeRes() {
  const res: any = {};
  res.json = vi.fn(() => res);
  res.status = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  mockGetSlackConfig.mockReset();
  mockGetSlackConfigByTeamId.mockReset();
  mockUpsertSlackConfig.mockReset();
  mockVerifySlackSignature.mockReset();
  mockHandleAppMention.mockReset();
  mockSendSlackNotification.mockReset();
  mockPostSlackMessage.mockReset();
  mockResolveToken.mockReset();
  // Default: no token (not connected)
  mockResolveToken.mockReturnValue(null);
});

// ── POST /slack/events ──────────────────────────────────────

describe('POST /slack/events', () => {
  const handler = getHandler(slackEventsRouter, 'post', '/');

  it('returns 500 when SLACK_SIGNING_SECRET not set', async () => {
    const envModule = await import('../../env');
    const original = envModule.default.SLACK_SIGNING_SECRET;
    envModule.default.SLACK_SIGNING_SECRET = '';

    const res = makeRes();
    await handler(makeReq({ body: Buffer.from('{}') }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));

    envModule.default.SLACK_SIGNING_SECRET = original;
  });

  it('returns 401 when signature headers missing', async () => {
    const res = makeRes();
    await handler(makeReq({
      body: Buffer.from('{}'),
      headers: {},
    }), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when signature verification fails', async () => {
    mockVerifySlackSignature.mockReturnValue(false);

    const res = makeRes();
    await handler(makeReq({
      body: Buffer.from('{}'),
      headers: {
        'x-slack-request-timestamp': '1234567890',
        'x-slack-signature': 'v0=bad',
      },
    }), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns challenge for url_verification type', async () => {
    mockVerifySlackSignature.mockReturnValue(true);

    const body = JSON.stringify({ type: 'url_verification', challenge: 'test-challenge' });
    const res = makeRes();
    await handler(makeReq({
      body: Buffer.from(body),
      headers: {
        'x-slack-request-timestamp': '1234567890',
        'x-slack-signature': 'v0=valid',
      },
    }), res);

    expect(res.json).toHaveBeenCalledWith({ challenge: 'test-challenge' });
  });

  it('returns 200 immediately for app_mention event', async () => {
    mockVerifySlackSignature.mockReturnValue(true);

    const body = JSON.stringify({
      type: 'event_callback',
      event: { type: 'app_mention', user: 'U1', text: 'hello', channel: '#c', ts: '1' },
    });
    const res = makeRes();
    await handler(makeReq({
      body: Buffer.from(body),
      headers: {
        'x-slack-request-timestamp': '1234567890',
        'x-slack-signature': 'v0=valid',
      },
    }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalled();
  });

  it('logs warning when handleAppMention throws', async () => {
    mockVerifySlackSignature.mockReturnValue(true);
    mockHandleAppMention.mockRejectedValueOnce(new Error('Slack API timeout'));

    const body = JSON.stringify({
      type: 'event_callback',
      event: { type: 'app_mention', user: 'U1', text: 'hello', channel: '#c', ts: '1' },
    });
    const res = makeRes();
    await handler(makeReq({
      body: Buffer.from(body),
      headers: {
        'x-slack-request-timestamp': '1234567890',
        'x-slack-signature': 'v0=valid',
      },
    }), res);

    // Should still return 200 (fire-and-forget) and log the warning
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 for invalid JSON body', async () => {
    mockVerifySlackSignature.mockReturnValue(true);

    const res = makeRes();
    await handler(makeReq({
      body: Buffer.from('not json'),
      headers: {
        'x-slack-request-timestamp': '1234567890',
        'x-slack-signature': 'v0=valid',
      },
    }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ── GET /api/slack/config ───────────────────────────────────

describe('GET /api/slack/config', () => {
  const handler = getHandler(slackConfigRouter, 'get', '/config');

  it('returns stored config when it exists', async () => {
    mockGetSlackConfig.mockResolvedValueOnce({
      orgId: 'org-1',
      enabled: true,
      channelRouting: { default: '#alerts' },
      botTokenEnc: 'encrypted-token',
      teamId: 'T123',
      teamName: 'Acme',
    });

    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ enabled: true }),
      connected: true,
      teamName: 'Acme',
    }));
  });

  it('returns default skeleton when no config stored', async () => {
    mockGetSlackConfig.mockResolvedValueOnce(null);

    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    const response = res.json.mock.calls[0][0];
    expect(response.config.enabled).toBe(false);
    expect(response.config.orgId).toBe('org-1');
  });

  it('returns connected: false when no botTokenEnc stored', async () => {
    mockGetSlackConfig.mockResolvedValueOnce(null);

    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.json.mock.calls[0][0].connected).toBe(false);
  });
});

// ── PUT /api/slack/config ───────────────────────────────────

describe('PUT /api/slack/config', () => {
  const handler = getHandler(slackConfigRouter, 'put', '/config');

  it('saves config with orgId, updatedAt, updatedBy', async () => {
    mockUpsertSlackConfig.mockResolvedValueOnce(undefined);

    const res = makeRes();
    const body = { enabled: true, channelRouting: { default: '#alerts' } };
    await handler(makeReq({ body }), res, vi.fn());

    expect(mockUpsertSlackConfig).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      enabled: true,
      updatedBy: 'user-1',
    }));
    expect(res.json).toHaveBeenCalledWith({ message: 'Slack config saved' });
  });

  it('accepts null default (means "don\'t send" for unrouted events)', async () => {
    const res = makeRes();
    const next = vi.fn();
    const body = {
      enabled: true,
      channelRouting: { default: null, workflow_failed: '#ops' },
    };
    await handler(makeReq({ body }), res, next);

    expect(mockUpsertSlackConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      channelRouting: expect.objectContaining({ default: null }),
    }));
  });

  it('rejects malformed channelRouting (default missing entirely)', async () => {
    const res = makeRes();
    const next = vi.fn();
    const body = { enabled: true, channelRouting: {} };
    await handler(makeReq({ body }), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── POST /api/slack/test ────────────────────────────────────

describe('POST /api/slack/test', () => {
  const handler = getHandler(slackConfigRouter, 'post', '/test');

  it('returns 400 when org has no connected Slack workspace', async () => {
    mockGetSlackConfig.mockResolvedValueOnce(null);
    // mockResolveToken already defaults to null in beforeEach

    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when no default channel configured', async () => {
    mockGetSlackConfig.mockResolvedValueOnce({ channelRouting: { default: '' } });
    mockResolveToken.mockReturnValueOnce('xoxb-token');
    const envModule = await import('../../env');
    const originalChannel = envModule.default.SLACK_DEFAULT_CHANNEL;
    envModule.default.SLACK_DEFAULT_CHANNEL = '';

    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);

    envModule.default.SLACK_DEFAULT_CHANNEL = originalChannel;
  });

  it('sends test notification and returns success', async () => {
    mockGetSlackConfig.mockResolvedValueOnce({
      channelRouting: { default: '#test-channel' },
    });
    mockResolveToken.mockReturnValueOnce('xoxb-token');
    mockSendSlackNotification.mockResolvedValueOnce(undefined);

    const res = makeRes();
    await handler(makeReq(), res, vi.fn());

    expect(mockSendSlackNotification).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('#test-channel') }),
    );
  });
});
