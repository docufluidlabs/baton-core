import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: {
    NOTIFICATIONS: 'notifications',
    NOTIFICATION_PREFERENCES: 'notification-preferences',
    USERS: 'users',
  },
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../env', () => ({
  default: {
    RESEND_API_KEY: 'test-resend-key',
    RESEND_FROM_EMAIL: 'test@baton.dev',
    FRONTEND_URL: 'http://localhost:5173',
    SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test',
  },
}));

const mockSlackNotification = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/slack.service', () => ({
  sendSlackNotification: (...args: any[]) => mockSlackNotification(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Imports (after mocks) ───────────────────────────────────

import {
  sendNotification,
  workflowFailedNotification,
  workflowLaunchedNotification,
  workflowCompletedNotification,
  workflowSyncedNotification,
  retryExhaustedNotification,
  executionQuotaExceededNotification,
  executionQuotaWarningNotification,
  connectionErrorNotification,
  connectionCreatedNotification,
  connectionDisconnectedNotification,
  rulePausedNotification,
  webhookFailedNotification,
  overageStartedNotification,
  hardCapReachedNotification,
  billingDriftNotification,
  trialEndingNotification,
  pastDueNotification,
  _testExports,
  type NotificationPayload,
  type NotificationPreferences,
  type NotificationSeverity,
} from '../../services/notification.service';
import { logError } from '../../lib/logger';

const { determineChannels, buildEmailHtml, getOrgPreferences, getRecipientEmail } = _testExports;

// ─── Helpers ─────────────────────────────────────────────────

function makePrefs(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    userId: 'user-1',
    email: true,
    inApp: true,
    mutedCategories: [],
    ...overrides,
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    orgId: 'org-1',
    recipientId: 'user-1',
    title: 'Test Notification',
    body: 'Something happened.',
    severity: 'info',
    category: 'general',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  mockSend.mockReset();
  mockFetch.mockReset();
  mockSlackNotification.mockReset().mockResolvedValue(undefined);
});

// ── determineChannels ────────────────────────────────────────

describe('determineChannels', () => {
  // Slack is always proposed here; per-org channelRouting (in slack.service)
  // makes the actual send-or-skip decision.
  it('error + all prefs enabled returns slack, in_app, email', () => {
    const channels = determineChannels('error', makePrefs());
    expect(channels).toEqual(['slack', 'in_app', 'email']);
  });

  it('warning + all prefs enabled returns slack, in_app, email', () => {
    const channels = determineChannels('warning', makePrefs());
    expect(channels).toEqual(['slack', 'in_app', 'email']);
  });

  it('info + all prefs enabled returns slack and in_app', () => {
    const channels = determineChannels('info', makePrefs());
    expect(channels).toEqual(['slack', 'in_app']);
  });

  it('success + all prefs enabled returns slack and in_app', () => {
    const channels = determineChannels('success', makePrefs());
    expect(channels).toEqual(['slack', 'in_app']);
  });

  it('error + email disabled returns slack and in_app', () => {
    const channels = determineChannels('error', makePrefs({ email: false }));
    expect(channels).toEqual(['slack', 'in_app']);
  });

  it('always proposes slack regardless of other prefs (delivery gated by channelRouting)', () => {
    const channels = determineChannels(
      'error',
      makePrefs({ inApp: false, email: false }),
    );
    expect(channels).toEqual(['slack']);
  });

  it('warning + inApp=false, email=true returns slack and email', () => {
    const channels = determineChannels(
      'warning',
      makePrefs({ inApp: false, email: true }),
    );
    expect(channels).toEqual(['slack', 'email']);
  });
});

// ── buildEmailHtml ───────────────────────────────────────────

describe('buildEmailHtml', () => {
  it('contains title and body text', () => {
    const html = buildEmailHtml(makePayload({ title: 'Alert', body: 'Details here' }));
    expect(html).toContain('Alert');
    expect(html).toContain('Details here');
  });

  it('includes View Details button when actionUrl is present', () => {
    const html = buildEmailHtml(
      makePayload({ actionUrl: 'http://localhost:5173/some-page' }),
    );
    expect(html).toContain('View Details');
    expect(html).toContain('http://localhost:5173/some-page');
  });

  it('has Manage preferences link but no button when actionUrl is absent', () => {
    const html = buildEmailHtml(makePayload());
    expect(html).not.toContain('View Details');
    expect(html).toContain('Manage preferences');
  });
});

// ── Template functions ───────────────────────────────────────

describe('workflowFailedNotification', () => {
  it('returns error severity with workflow_failed category', () => {
    const payload = workflowFailedNotification(
      'org-1',
      'user-1',
      'Daily Sync',
      'inst-42',
      'timeout',
    );
    expect(payload.severity).toBe('error');
    expect(payload.category).toBe('workflow_failed');
  });

  it('title contains workflow name', () => {
    const payload = workflowFailedNotification(
      'org-1',
      'user-1',
      'Daily Sync',
      'inst-42',
      'timeout',
    );
    expect(payload.title).toContain('Daily Sync');
  });

  it('metadata includes instanceId', () => {
    const payload = workflowFailedNotification(
      'org-1',
      'user-1',
      'Daily Sync',
      'inst-42',
      'timeout',
    );
    expect(payload.metadata).toEqual(
      expect.objectContaining({ instanceId: 'inst-42' }),
    );
  });
});

describe('webhookFailedNotification', () => {
  it('returns warning severity with webhook_failed category', () => {
    const payload = webhookFailedNotification(
      'org-1',
      'admin-1',
      'bamboohr',
      'HMAC mismatch',
    );
    expect(payload.severity).toBe('warning');
    expect(payload.category).toBe('webhook_failed');
  });

  it('title includes the platform name', () => {
    const payload = webhookFailedNotification('org-1', 'admin-1', 'bamboohr', 'bad sig');
    expect(payload.title).toContain('bamboohr');
    expect(payload.title.toLowerCase()).toContain('webhook');
  });

  it('body includes the verification reason', () => {
    const payload = webhookFailedNotification('org-1', 'admin-1', 'bamboohr', 'timestamp skew');
    expect(payload.body).toContain('timestamp skew');
  });

  it('metadata captures platform + reason for downstream consumers (Slack blocks etc.)', () => {
    const payload = webhookFailedNotification('org-1', 'admin-1', 'pipedrive', 'invalid HMAC');
    expect(payload.metadata).toEqual({ platform: 'pipedrive', reason: 'invalid HMAC' });
  });

  it('routes to the connections page so admins can fix the secret', () => {
    const payload = webhookFailedNotification('org-1', 'admin-1', 'hubspot', 'bad sig');
    expect(payload.actionUrl).toContain('/connections');
  });
});

describe('connectionErrorNotification', () => {
  it('returns warning severity', () => {
    const payload = connectionErrorNotification('org-1', 'user-1', 'Salesforce', 'auth failed');
    expect(payload.severity).toBe('warning');
  });

  it('title contains platform name', () => {
    const payload = connectionErrorNotification('org-1', 'user-1', 'Salesforce', 'auth failed');
    expect(payload.title).toContain('Salesforce');
  });
});

describe('rulePausedNotification', () => {
  it('returns warning severity with rule_error category', () => {
    const payload = rulePausedNotification('org-1', 'user-1', 'Auto-Assign', 'too many errors');
    expect(payload.severity).toBe('warning');
    expect(payload.category).toBe('rule_error');
  });

  it('body contains the reason', () => {
    const payload = rulePausedNotification('org-1', 'user-1', 'Auto-Assign', 'too many errors');
    expect(payload.body).toContain('too many errors');
  });
});

// ── sendNotification ─────────────────────────────────────────

describe('sendNotification', () => {
  it('does not send when category is muted', async () => {
    // getOrgPreferences will be called first — return prefs with muted category
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        email: true,
        slack: true,
        inApp: true,
        mutedCategories: ['general'],
      }],
    });

    await sendNotification(makePayload({ category: 'general' }));

    // Only the getOrgPreferences call should have happened (GetCommand)
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('creates in-app notification via PutCommand for in_app channel', async () => {
    // getOrgPreferences
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        email: true,
        slack: true,
        inApp: true,
        mutedCategories: [],
      }],
    });
    // createInAppNotification (PutCommand)
    mockSend.mockResolvedValueOnce({});

    await sendNotification(makePayload({ severity: 'info' }));

    // Second call is the PutCommand for in-app
    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.input.TableName).toBe('notifications');
    expect(putCall.input.Item.read).toBe(false);
    expect(putCall.input.Item.dismissed).toBe(false);
    expect(putCall.input.Item.recipientId).toBe('user-1');
  });

  it('uses explicit channels when provided in payload', async () => {
    // getOrgPreferences
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        email: true,
        slack: true,
        inApp: true,
        mutedCategories: [],
      }],
    });
    // getRecipientEmail
    mockSend.mockResolvedValueOnce({ Item: { id: 'user-1', email: 'user@test.com' } });
    // email fetch
    mockFetch.mockResolvedValueOnce({ ok: true });

    await sendNotification(
      makePayload({ severity: 'info', channels: ['email'] }),
    );

    // Should have called fetch for email even though severity=info
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
  });

  it('skips email when RESEND_API_KEY is absent', async () => {
    // Temporarily override env
    const envModule = await import('../../env');
    const originalKey = envModule.default.RESEND_API_KEY;
    envModule.default.RESEND_API_KEY = '';

    // getOrgPreferences
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        email: true,
        slack: true,
        inApp: true,
        mutedCategories: [],
      }],
    });
    // createInAppNotification
    mockSend.mockResolvedValueOnce({});

    await sendNotification(
      makePayload({ severity: 'warning', channels: ['in_app', 'email'] }),
    );

    // fetch should not have been called for email
    expect(mockFetch).not.toHaveBeenCalled();

    // Restore
    envModule.default.RESEND_API_KEY = originalKey;
  });

  it('sends slack notification via slack.service when slack channel enabled', async () => {
    // getOrgPreferences
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        email: false,
        slack: true,
        inApp: true,
        mutedCategories: [],
      }],
    });
    // createInAppNotification
    mockSend.mockResolvedValueOnce({});

    await sendNotification(
      makePayload({ severity: 'error', channels: ['in_app', 'slack'] }),
    );

    expect(mockSlackNotification).toHaveBeenCalledTimes(1);
  });

  it('sends email when severity is error and all prefs enabled', async () => {
    // getOrgPreferences (QueryCommand returns Items)
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        email: true,
        slack: true,
        inApp: true,
        mutedCategories: [],
      }],
    });
    // createInAppNotification
    mockSend.mockResolvedValueOnce({});
    // getRecipientEmail
    mockSend.mockResolvedValueOnce({ Item: { id: 'user-1', email: 'user@test.com' } });
    // Resend API
    mockFetch.mockResolvedValueOnce({ ok: true });

    await sendNotification(makePayload({ severity: 'error' }));

    // fetch called for email; slack goes through mocked sendSlackNotification
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockSlackNotification).toHaveBeenCalledTimes(1);
  });

  it('calls sendSlackNotification for slack channel', async () => {
    // getOrgPreferences
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        email: false,
        slack: true,
        inApp: false,
        mutedCategories: [],
      }],
    });

    await sendNotification(
      makePayload({ severity: 'error', channels: ['slack'], title: 'Test Slack' }),
    );

    expect(mockSlackNotification).toHaveBeenCalledTimes(1);
    expect(mockSlackNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Test Slack' }),
    );
  });

  it('handles email pref disabled — does not send email even for error severity', async () => {
    // getOrgPreferences with email=false
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        email: false,
        slack: true,
        inApp: true,
        mutedCategories: [],
      }],
    });
    // createInAppNotification
    mockSend.mockResolvedValueOnce({});

    await sendNotification(makePayload({ severity: 'error' }));

    // No email fetch, only slack via mock
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSlackNotification).toHaveBeenCalledTimes(1);
  });
});

// ── getOrgPreferences ───────────────────────────────────────────

describe('getOrgPreferences', () => {
  it('returns stored preferences from DB', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        email: false,
        inApp: true,
        mutedCategories: ['workflow_failed'],
      }],
    });

    const prefs = await getOrgPreferences('user-1');

    expect(prefs.email).toBe(false);
    expect(prefs.inApp).toBe(true);
    expect(prefs.mutedCategories).toEqual(['workflow_failed']);
  });

  it('returns defaults when DB throws an error', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB unreachable'));

    const prefs = await getOrgPreferences('user-1');

    expect(prefs.email).toBe(true);
    expect(prefs.inApp).toBe(true);
    expect(prefs.mutedCategories).toEqual([]);
  });
});

// ── getRecipientEmail ────────────────────────────────────────

describe('getRecipientEmail', () => {
  it('returns email from USERS table, null on error', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { id: 'user-1', email: 'alice@example.com' },
    });

    const email = await getRecipientEmail('user-1');
    expect(email).toBe('alice@example.com');

    mockSend.mockRejectedValueOnce(new Error('DB error'));
    const fallback = await getRecipientEmail('user-1');
    expect(fallback).toBeNull();
  });
});

// ── determineChannels — per-event preferences ───────────────

describe('determineChannels — per-event preferences', () => {
  it('uses event-specific prefs when events[category] exists (always includes slack)', () => {
    const prefs = makePrefs({
      events: {
        workflow_failed: { inApp: true, email: true },
      },
    });
    const channels = determineChannels('info', prefs, 'workflow_failed');
    expect(channels).toEqual(['slack', 'in_app', 'email']);
  });

  it('returns just slack when event prefs disable in_app and email', () => {
    const prefs = makePrefs({
      events: {
        workflow_synced: { inApp: false, email: false },
      },
    });
    const channels = determineChannels('info', prefs, 'workflow_synced');
    expect(channels).toEqual(['slack']);
  });

  it('uses severity fallback when category not in events', () => {
    const prefs = makePrefs({
      events: {
        workflow_failed: { inApp: true, email: true },
      },
    });
    // 'general' is not in events, should fall back to severity-based
    const channels = determineChannels('info', prefs, 'general');
    expect(channels).toContain('in_app');
    // info severity doesn't include email
    expect(channels).not.toContain('email');
  });
});

// ── sendEmailNotification edge cases ─────────────────────────

describe('sendEmailNotification edge cases', () => {
  it('skips email when getRecipientEmail returns null', async () => {
    // getOrgPreferences
    mockSend.mockResolvedValueOnce({
      Items: [{ userId: 'user-1', email: true, slack: false, inApp: false, mutedCategories: [] }],
    });
    // getRecipientEmail returns no user
    mockSend.mockResolvedValueOnce({ Item: undefined });

    await sendNotification(makePayload({ severity: 'error', channels: ['email'] }));

    // fetch should not have been called (no recipient email)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('logs error when Resend API returns non-ok response', async () => {
    // getOrgPreferences
    mockSend.mockResolvedValueOnce({
      Items: [{ userId: 'user-1', email: true, slack: false, inApp: false, mutedCategories: [] }],
    });
    // getRecipientEmail
    mockSend.mockResolvedValueOnce({ Item: { id: 'user-1', email: 'bob@test.com' } });
    // Resend API returns error
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'Invalid email' });

    await sendNotification(makePayload({ severity: 'error', channels: ['email'] }));

    expect(logError).toHaveBeenCalledWith(
      'Resend email failed',
      expect.objectContaining({ status: 422 }),
    );
  });

  it('catches fetch exceptions without throwing', async () => {
    // getOrgPreferences
    mockSend.mockResolvedValueOnce({
      Items: [{ userId: 'user-1', email: true, slack: false, inApp: false, mutedCategories: [] }],
    });
    // getRecipientEmail
    mockSend.mockResolvedValueOnce({ Item: { id: 'user-1', email: 'bob@test.com' } });
    // fetch throws
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw
    await sendNotification(makePayload({ severity: 'error', channels: ['email'] }));

    expect(logError).toHaveBeenCalledWith(
      'Failed to send email notification',
      expect.any(Error),
    );
  });

  it('uses fallback from-email when RESEND_FROM_EMAIL is empty', async () => {
    const envModule = await import('../../env');
    const original = envModule.default.RESEND_FROM_EMAIL;
    envModule.default.RESEND_FROM_EMAIL = '';

    mockSend.mockResolvedValueOnce({
      Items: [{ userId: 'user-1', email: true, slack: false, inApp: false, mutedCategories: [] }],
    });
    mockSend.mockResolvedValueOnce({ Item: { id: 'user-1', email: 'bob@test.com' } });
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    await sendNotification(makePayload({ severity: 'error', channels: ['email'] }));

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.from).toBe('Baton <notifications@baton.dev>');

    envModule.default.RESEND_FROM_EMAIL = original;
  });

  it('handles unknown severity emoji gracefully', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ userId: 'user-1', email: true, slack: false, inApp: false, mutedCategories: [] }],
    });
    mockSend.mockResolvedValueOnce({ Item: { id: 'user-1', email: 'bob@test.com' } });
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    await sendNotification(makePayload({
      severity: 'unknown_severity' as any,
      channels: ['email'],
    }));

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Unknown severity falls back to empty string prefix
    expect(fetchBody.subject).toBe(' Test Notification');
  });
});

// ── createInAppNotification ─────────────────────────────────

describe('createInAppNotification', () => {
  it('catches DynamoDB error and logs without throwing', async () => {
    // getOrgPreferences
    mockSend.mockResolvedValueOnce({
      Items: [{ userId: 'user-1', email: false, slack: false, inApp: true, mutedCategories: [] }],
    });
    // createInAppNotification fails
    mockSend.mockRejectedValueOnce(new Error('DynamoDB write error'));

    // Should not throw
    await sendNotification(makePayload({ severity: 'info' }));

    expect(logError).toHaveBeenCalledWith(
      'Failed to create in-app notification',
      expect.any(Error),
    );
  });
});

// ── sendNotification — partial channel failure ──────────────

describe('sendNotification — partial channel failure', () => {
  it('logs failures from Promise.allSettled but does not throw', async () => {
    // getOrgPreferences — enable all channels
    mockSend.mockResolvedValueOnce({
      Items: [{ userId: 'user-1', email: true, slack: true, inApp: true, mutedCategories: [] }],
    });
    // createInAppNotification succeeds
    mockSend.mockResolvedValueOnce({});
    // getRecipientEmail
    mockSend.mockResolvedValueOnce({ Item: { id: 'user-1', email: 'bob@test.com' } });
    // Resend API succeeds
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    // Slack rejects — this triggers lines 94-98 (Promise.allSettled failure branch)
    mockSlackNotification.mockRejectedValueOnce(new Error('Slack API down'));

    // Should not throw even though slack failed
    await sendNotification(makePayload({ severity: 'error' }));

    expect(logError).toHaveBeenCalledWith(
      'Some notification channels failed',
      null,
      expect.objectContaining({
        failures: ['Slack API down'],
      }),
    );
  });

  it('in_app succeeds even when email channel fails', async () => {
    // getOrgPreferences — enable in_app + email, no slack
    mockSend.mockResolvedValueOnce({
      Items: [{ userId: 'user-1', email: true, slack: false, inApp: true, mutedCategories: [] }],
    });
    // createInAppNotification succeeds
    mockSend.mockResolvedValueOnce({});
    // getRecipientEmail
    mockSend.mockResolvedValueOnce({ Item: { id: 'user-1', email: 'bob@test.com' } });
    // Resend API fails
    mockFetch.mockRejectedValueOnce(new Error('Resend down'));

    await sendNotification(makePayload({ severity: 'error' }));

    // In-app should have been created (second mockSend call)
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});

// ── getOrgPreferences — event merging ──────────────────────────

describe('getOrgPreferences — event merging', () => {
  it('merges saved events with DEFAULT_EVENT_PREFS so new event types appear', async () => {
    // Return saved prefs with only 2 event types
    mockSend.mockResolvedValueOnce({
      Items: [{
        userId: 'user-1',
        email: true,
        inApp: true,
        mutedCategories: [],
        events: {
          workflow_failed: { inApp: true, email: false },
        },
      }],
    });

    const prefs = await getOrgPreferences('user-1');

    // Saved event should use saved value
    expect(prefs.events?.workflow_failed).toEqual({ inApp: true, email: false });
    // New event type should have default value
    expect(prefs.events?.automation_failed).toEqual({ inApp: true, email: true });
    expect(prefs.events?.execution_quota_exceeded).toEqual({ inApp: true, email: true });
  });

  it('returns defaults with full DEFAULT_EVENT_PREFS when no DB record exists', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const prefs = await getOrgPreferences('user-1');

    expect(prefs.events).toBeDefined();
    expect(prefs.events?.workflow_failed).toEqual({ inApp: true, email: true });
    expect(prefs.events?.automation_failed).toEqual({ inApp: true, email: true });
  });

  it('defaults mutedCategories to [] when DB record has no mutedCategories', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ userId: 'user-1', email: true, inApp: true }],
    });

    const prefs = await getOrgPreferences('user-1');
    expect(prefs.mutedCategories).toEqual([]);
  });

  it('returns defaults when DynamoDB query throws', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB read error'));

    const prefs = await getOrgPreferences('user-1');

    expect(prefs.email).toBe(true);
    expect(prefs.mutedCategories).toEqual([]);
    expect(logError).toHaveBeenCalledWith(
      'Failed to load notification preferences',
      expect.any(Error),
    );
  });
});

// ── Template functions ──────────────────────────────────────

describe('workflowLaunchedNotification', () => {
  it('returns info severity with workflow_launched category', () => {
    const p = workflowLaunchedNotification('org-1', 'user-1', 'Daily Sync', 'inst-1');
    expect(p.severity).toBe('info');
    expect(p.category).toBe('workflow_launched');
  });

  it('metadata contains workflowName and instanceId', () => {
    const p = workflowLaunchedNotification('org-1', 'user-1', 'Daily Sync', 'inst-1');
    expect(p.metadata).toEqual(expect.objectContaining({ workflowName: 'Daily Sync', instanceId: 'inst-1' }));
  });

  it('body uses instanceName when provided, generic text when absent', () => {
    const withName = workflowLaunchedNotification('org-1', 'user-1', 'WF', 'inst-1', 'My Instance');
    expect(withName.body).toContain('My Instance');

    const withoutName = workflowLaunchedNotification('org-1', 'user-1', 'WF', 'inst-1');
    expect(withoutName.body).toContain('A new instance is now running');
  });
});

describe('workflowCompletedNotification', () => {
  it('returns success severity with workflow_completed category', () => {
    const p = workflowCompletedNotification('org-1', 'user-1', 'Export', 'inst-2');
    expect(p.severity).toBe('success');
    expect(p.category).toBe('workflow_completed');
  });

  it('metadata contains durationMs when provided', () => {
    const p = workflowCompletedNotification('org-1', 'user-1', 'Export', 'inst-2', 45000);
    expect(p.metadata).toEqual(expect.objectContaining({ durationMs: 45000 }));
  });
});

describe('workflowSyncedNotification', () => {
  it('returns info severity with workflow_synced category', () => {
    const p = workflowSyncedNotification('org-1', 'user-1', 3);
    expect(p.severity).toBe('info');
    expect(p.category).toBe('workflow_synced');
  });

  it('pluralizes title correctly for count=1 vs count>1', () => {
    const one = workflowSyncedNotification('org-1', 'user-1', 1);
    expect(one.title).toBe('1 workflow synced');

    const many = workflowSyncedNotification('org-1', 'user-1', 5);
    expect(many.title).toBe('5 workflows synced');
  });

  it('body includes new/updated breakdown when newCount provided', () => {
    const p = workflowSyncedNotification('org-1', 'user-1', 5, 2);
    expect(p.body).toContain('2 new');
    expect(p.body).toContain('3 updated');
  });
});

describe('retryExhaustedNotification', () => {
  it('returns error severity with automation_failed category', () => {
    const p = retryExhaustedNotification('org-1', 'user-1', 'Import', 'inst-3', 3);
    expect(p.severity).toBe('error');
    expect(p.category).toBe('automation_failed');
  });

  it('body includes retryMaxAttempts count', () => {
    const p = retryExhaustedNotification('org-1', 'user-1', 'Import', 'inst-3', 5);
    expect(p.body).toContain('5');
  });
});

describe('executionQuotaExceededNotification', () => {
  it('returns error severity with execution_quota_exceeded category', () => {
    const p = executionQuotaExceededNotification('org-1', 'user-1', 100, 100);
    expect(p.severity).toBe('error');
    expect(p.category).toBe('execution_quota_exceeded');
  });

  it('body mentions workflowName when provided', () => {
    const p = executionQuotaExceededNotification('org-1', 'user-1', 100, 100, 'Daily Sync');
    expect(p.body).toContain('Daily Sync');
  });

  it('body excludes workflowName when absent', () => {
    const p = executionQuotaExceededNotification('org-1', 'user-1', 100, 100);
    expect(p.body).not.toContain('undefined');
  });
});

describe('executionQuotaWarningNotification', () => {
  it('returns warning severity with execution_quota_warning category', () => {
    const p = executionQuotaWarningNotification('org-1', 'user-1', 80, 100);
    expect(p.severity).toBe('warning');
    expect(p.category).toBe('execution_quota_warning');
  });

  it('title contains computed percentage', () => {
    const p = executionQuotaWarningNotification('org-1', 'user-1', 80, 100);
    expect(p.title).toContain('80%');
  });

  it('metadata includes pct field', () => {
    const p = executionQuotaWarningNotification('org-1', 'user-1', 80, 100);
    expect(p.metadata?.pct).toBe(80);
  });
});

describe('connectionCreatedNotification', () => {
  it('returns success severity with connection_created category', () => {
    const p = connectionCreatedNotification('org-1', 'user-1', 'HubSpot', 'My HubSpot');
    expect(p.severity).toBe('success');
    expect(p.category).toBe('connection_created');
  });

  it('title contains displayName', () => {
    const p = connectionCreatedNotification('org-1', 'user-1', 'HubSpot', 'My HubSpot');
    expect(p.title).toContain('My HubSpot');
  });
});

describe('connectionDisconnectedNotification', () => {
  it('returns error severity with connection_disconnected category', () => {
    const p = connectionDisconnectedNotification('org-1', 'user-1', 'HubSpot', 'My HubSpot');
    expect(p.severity).toBe('error');
    expect(p.category).toBe('connection_disconnected');
  });

  it('body includes reason when provided', () => {
    const p = connectionDisconnectedNotification('org-1', 'user-1', 'HubSpot', 'My HubSpot', 'Token revoked');
    expect(p.body).toContain('Token revoked');
  });

  it('body uses generic removal text when reason absent', () => {
    const p = connectionDisconnectedNotification('org-1', 'user-1', 'HubSpot', 'My HubSpot');
    expect(p.body).toContain('has been removed');
  });
});

// ─── Billing notifications (metered-billing migration) ───────

describe('overageStartedNotification', () => {
  it('returns info severity with billing_overage_started category', () => {
    const p = overageStartedNotification('org-1', 'user-1', 100, 50);
    expect(p.severity).toBe('info');
    expect(p.category).toBe('billing_overage_started');
  });

  it('title states how many included relays were exhausted', () => {
    const p = overageStartedNotification('org-1', 'user-1', 1000, 12);
    expect(p.title).toContain('1000');
  });

  it('body shows formatted dollar overage rate', () => {
    const p = overageStartedNotification('org-1', 'user-1', 100, 50);
    expect(p.body).toContain('$0.50');
  });

  it('metadata captures both included and rate in cents', () => {
    const p = overageStartedNotification('org-1', 'user-1', 1000, 12);
    expect(p.metadata).toEqual({ includedRelays: 0, overageRateCents: 0 });
  });

  it('actionUrl points to /settings?tab=billing', () => {
    const p = overageStartedNotification('org-1', 'user-1', 100, 50);
    expect(p.actionUrl).toContain('/settings?tab=billing');
  });
});

describe('hardCapReachedNotification', () => {
  it('returns warning severity with billing_hard_cap category', () => {
    const p = hardCapReachedNotification('org-1', 'user-1', 5000, 5000);
    expect(p.severity).toBe('warning');
    expect(p.category).toBe('billing_hard_cap');
  });

  it('title contains cap value', () => {
    const p = hardCapReachedNotification('org-1', 'user-1', 5000, 5012);
    expect(p.title).toContain('5000');
  });

  it('body mentions automation pause + cycle reset', () => {
    const p = hardCapReachedNotification('org-1', 'user-1', 5000, 5012);
    expect(p.body).toMatch(/paused/i);
    expect(p.body).toMatch(/cycle resets/i);
  });

  it('metadata includes both cap and used', () => {
    const p = hardCapReachedNotification('org-1', 'user-1', 5000, 5012);
    expect(p.metadata).toEqual({ cap: 5000, used: 5012 });
  });
});

describe('billingDriftNotification', () => {
  it('returns warning severity with billing_drift category', () => {
    const p = billingDriftNotification('org-1', 'user-1', 100, 95);
    expect(p.severity).toBe('warning');
    expect(p.category).toBe('billing_drift');
  });

  it('body shows both local and Stripe counts', () => {
    const p = billingDriftNotification('org-1', 'user-1', 100, 95);
    expect(p.body).toContain('100');
    expect(p.body).toContain('95');
  });

  it('metadata.drift = abs(local − stripe)', () => {
    const p1 = billingDriftNotification('org-1', 'user-1', 100, 95);
    expect(p1.metadata?.drift).toBe(5);

    const p2 = billingDriftNotification('org-1', 'user-1', 95, 100);
    expect(p2.metadata?.drift).toBe(5);

    const p3 = billingDriftNotification('org-1', 'user-1', 100, 100);
    expect(p3.metadata?.drift).toBe(0);
  });
});

describe('trialEndingNotification', () => {
  it('returns warning severity with billing_trial_ending category', () => {
    const p = trialEndingNotification('org-1', 'user-1', 3);
    expect(p.severity).toBe('warning');
    expect(p.category).toBe('billing_trial_ending');
  });

  it('title pluralizes days correctly', () => {
    expect(trialEndingNotification('org-1', 'user-1', 1).title).toBe(
      'Free trial ends in 1 day',
    );
    expect(trialEndingNotification('org-1', 'user-1', 3).title).toBe(
      'Free trial ends in 3 days',
    );
  });

  it('metadata captures daysRemaining', () => {
    const p = trialEndingNotification('org-1', 'user-1', 7);
    expect(p.metadata).toEqual({ daysRemaining: 7 });
  });
});

describe('pastDueNotification', () => {
  it('returns error severity with billing_past_due category', () => {
    const p = pastDueNotification('org-1', 'user-1');
    expect(p.severity).toBe('error');
    expect(p.category).toBe('billing_past_due');
  });

  it('title mentions payment failure', () => {
    const p = pastDueNotification('org-1', 'user-1');
    expect(p.title).toMatch(/payment failed/i);
  });

  it('actionUrl points users to /settings?tab=billing to update payment', () => {
    const p = pastDueNotification('org-1', 'user-1');
    expect(p.actionUrl).toContain('/settings?tab=billing');
  });
});
