import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';

// ─── Hoisted mocks ──────────────────────────────────────────

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: {
    SLACK_CONFIGS: 'baton-slack-configs',
  },
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const mockDecryptToken = vi.fn();
vi.mock('../../lib/encryption', () => ({
  decryptToken: (...args: any[]) => mockDecryptToken(...args),
}));

vi.mock('../../env', () => ({
  default: {
    SLACK_DEFAULT_CHANNEL: '#general',
    FRONTEND_URL: 'http://localhost:5173',
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Imports (after mocks) ──────────────────────────────────

import {
  getSlackConfig,
  upsertSlackConfig,
  postSlackMessage,
  sendSlackNotification,
  verifySlackSignature,
  handleAppMention,
  _testExports,
} from '../../services/slack.service';
import type { NotificationPayload } from '../../services/notification.service';
import type { SlackConfig } from '../../lib/types';
import { logInfo, logWarn, logError, logDebug } from '../../lib/logger';

const { resolveChannel, resolveToken, buildBlocks, buildGenericBlocks } = _testExports;

// ─── Helpers ────────────────────────────────────────────────

function makeConfig(overrides: Partial<SlackConfig> = {}): SlackConfig {
  return {
    orgId: 'org-1',
    enabled: true,
    channelRouting: { default: '#alerts' },
    botTokenEnc: 'encrypted-token',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    orgId: 'org-1',
    recipientId: 'user-1',
    title: 'Test Alert',
    body: 'Something happened.',
    severity: 'info',
    category: 'general',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────

beforeEach(() => {
  mockSend.mockReset();
  mockFetch.mockReset();
  mockDecryptToken.mockReset();
  // Default: decryption succeeds
  mockDecryptToken.mockReturnValue('xoxb-decrypted-token');
  vi.mocked(logInfo).mockReset();
  vi.mocked(logWarn).mockReset();
  vi.mocked(logError).mockReset();
  vi.mocked(logDebug).mockReset();
});

// ── getSlackConfig ──────────────────────────────────────────

describe('getSlackConfig', () => {
  // Clear config cache between tests by calling with unique org IDs
  // or by testing cache behavior explicitly

  it('returns config from DynamoDB when not cached', async () => {
    const config = makeConfig({ orgId: 'org-fresh-1' });
    mockSend.mockResolvedValueOnce({ Item: config });

    const result = await getSlackConfig('org-fresh-1');

    expect(result).toEqual(config);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns cached config within TTL window', async () => {
    const config = makeConfig({ orgId: 'org-cache-1' });
    mockSend.mockResolvedValueOnce({ Item: config });

    // First call populates cache
    await getSlackConfig('org-cache-1');
    // Second call should use cache
    const result = await getSlackConfig('org-cache-1');

    expect(result).toEqual(config);
    expect(mockSend).toHaveBeenCalledTimes(1); // Only one DB call
  });

  it('returns null when no DynamoDB item exists', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await getSlackConfig('org-empty-1');

    expect(result).toBeNull();
  });

  it('returns null and logs error on DynamoDB failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB unreachable'));

    const result = await getSlackConfig('org-error-1');

    expect(result).toBeNull();
    expect(logError).toHaveBeenCalledWith(
      'Failed to load Slack config',
      expect.any(Error),
      expect.objectContaining({ orgId: 'org-error-1' }),
    );
  });
});

// ── upsertSlackConfig ───────────────────────────────────────

describe('upsertSlackConfig', () => {
  it('saves config to DynamoDB via PutCommand', async () => {
    const config = makeConfig({ orgId: 'org-upsert-1' });
    mockSend.mockResolvedValueOnce({});

    await upsertSlackConfig(config);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('baton-slack-configs');
    expect(cmd.input.Item).toEqual(config);
  });

  it('invalidates cache after save', async () => {
    const config = makeConfig({ orgId: 'org-upsert-cache-1' });
    // Populate cache first
    mockSend.mockResolvedValueOnce({ Item: config });
    await getSlackConfig('org-upsert-cache-1');

    // Upsert invalidates cache
    mockSend.mockResolvedValueOnce({});
    await upsertSlackConfig(config);

    // Next get should hit DB again
    mockSend.mockResolvedValueOnce({ Item: { ...config, enabled: false } });
    const result = await getSlackConfig('org-upsert-cache-1');

    expect(result?.enabled).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});

// ── resolveChannel ──────────────────────────────────────────

describe('resolveChannel', () => {
  it('returns null when config is null', () => {
    const channel = resolveChannel(null, 'workflow_failed');
    expect(channel).toBeNull();
  });

  it('returns null when config.enabled is false', () => {
    const channel = resolveChannel(makeConfig({ enabled: false }), 'workflow_failed');
    expect(channel).toBeNull();
  });

  it('returns category-specific channel from routing when present', () => {
    const config = makeConfig({
      channelRouting: { default: '#alerts', workflow_failed: '#errors' },
    });
    const channel = resolveChannel(config, 'workflow_failed');
    expect(channel).toBe('#errors');
  });

  it('falls back to routing.default when category not in routing', () => {
    const config = makeConfig({ channelRouting: { default: '#alerts' } });
    const channel = resolveChannel(config, 'workflow_synced');
    expect(channel).toBe('#alerts');
  });

  it('falls back to env.SLACK_DEFAULT_CHANNEL when routing.default missing', () => {
    const config = makeConfig({ channelRouting: { default: '' } });
    const channel = resolveChannel(config, 'general');
    expect(channel).toBe('#general');
  });
});

// ── resolveToken ────────────────────────────────────────────

describe('resolveToken', () => {
  it('decrypts per-org botTokenEnc when present', () => {
    mockDecryptToken.mockReturnValue('xoxb-per-org-token');
    const config = makeConfig({ botTokenEnc: 'encrypted-blob' });

    const token = resolveToken(config);

    expect(token).toBe('xoxb-per-org-token');
    expect(mockDecryptToken).toHaveBeenCalledWith('encrypted-blob');
  });

  it('returns null when decryption fails', () => {
    mockDecryptToken.mockImplementation(() => { throw new Error('decrypt fail'); });
    const config = makeConfig({ botTokenEnc: 'bad-encrypted' });

    const token = resolveToken(config);

    expect(token).toBeNull();
  });

  it('returns null when no botTokenEnc stored', () => {
    const token = resolveToken(makeConfig({ botTokenEnc: undefined }));
    expect(token).toBeNull();
  });

  it('returns null when config is null', () => {
    expect(resolveToken(null)).toBeNull();
  });
});

// ── postSlackMessage ────────────────────────────────────────

describe('postSlackMessage', () => {
  it('calls Slack API with correct Authorization header and JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true, channel: '#alerts', ts: '123.456' }),
    });

    await postSlackMessage('xoxb-token', { channel: '#alerts', text: 'hello' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(opts.headers.Authorization).toBe('Bearer xoxb-token');
    const body = JSON.parse(opts.body);
    expect(body.channel).toBe('#alerts');
    expect(body.text).toBe('hello');
    expect(body.unfurl_links).toBe(false);
  });

  it('returns parsed JSON response', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true, ts: '123.456' }),
    });

    const result = await postSlackMessage('xoxb-token', { channel: '#c', text: 'hi' });
    expect(result.ok).toBe(true);
    expect(result.ts).toBe('123.456');
  });

  it('logs warning when response.ok is false', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    });

    await postSlackMessage('xoxb-token', { channel: '#bad', text: 'hi' });

    expect(logWarn).toHaveBeenCalledWith(
      'Slack API error',
      expect.objectContaining({ error: 'channel_not_found' }),
    );
  });
});

// ── buildBlocks — dispatch by category ──────────────────────

describe('buildBlocks', () => {
  it('workflow_launched produces header with "Workflow Launched"', () => {
    const blocks = buildBlocks(makePayload({
      category: 'workflow_launched',
      metadata: { workflowName: 'Daily Sync', instanceId: 'inst-1' },
    }));
    const header = blocks.find((b: any) => b.type === 'header');
    expect(header?.text.text).toContain('Workflow Launched');
  });

  it('workflow_failed produces header with "Workflow Failed"', () => {
    const blocks = buildBlocks(makePayload({
      category: 'workflow_failed',
      severity: 'error',
      metadata: { workflowName: 'Import', instanceId: 'inst-2' },
    }));
    const header = blocks.find((b: any) => b.type === 'header');
    expect(header?.text.text).toContain('Workflow Failed');
  });

  it('workflow_failed includes errorStep when present in metadata', () => {
    const blocks = buildBlocks(makePayload({
      category: 'workflow_failed',
      severity: 'error',
      metadata: { workflowName: 'X', instanceId: 'i-1', errorStep: 'Step 3', retryCount: 2 },
    }));
    const sections = blocks.filter((b: any) => b.type === 'section');
    const hasErrorStep = sections.some((s: any) =>
      s.fields?.some((f: any) => f.text.includes('Step 3')),
    );
    expect(hasErrorStep).toBe(true);
  });

  it('workflow_completed produces header with duration when durationMs set', () => {
    const blocks = buildBlocks(makePayload({
      category: 'workflow_completed',
      severity: 'success',
      metadata: { workflowName: 'Export', instanceId: 'i-3', durationMs: 45000 },
    }));
    const durationSection = blocks.find((b: any) =>
      b.type === 'section' && b.text?.text?.includes('Duration'),
    );
    expect(durationSection).toBeDefined();
    expect(durationSection?.text.text).toContain('45s');
  });

  it('workflow_completed omits duration when durationMs absent', () => {
    const blocks = buildBlocks(makePayload({
      category: 'workflow_completed',
      severity: 'success',
      metadata: { workflowName: 'Export', instanceId: 'i-3' },
    }));
    const durationSection = blocks.find((b: any) =>
      b.type === 'section' && b.text?.text?.includes('Duration'),
    );
    expect(durationSection).toBeUndefined();
  });

  it('connection_degraded uses connection blocks with platform/connectionId', () => {
    const blocks = buildBlocks(makePayload({
      category: 'connection_degraded',
      severity: 'warning',
      metadata: { platform: 'Salesforce', connectionId: 'conn-1' },
    }));
    const sections = blocks.filter((b: any) => b.type === 'section');
    const hasPlatform = sections.some((s: any) =>
      s.fields?.some((f: any) => f.text.includes('Salesforce')),
    );
    expect(hasPlatform).toBe(true);
  });

  it('connection_created produces "Connection Created" header', () => {
    const blocks = buildBlocks(makePayload({
      category: 'connection_created',
      severity: 'success',
      metadata: { platform: 'HubSpot', displayName: 'My HubSpot' },
    }));
    const header = blocks.find((b: any) => b.type === 'header');
    expect(header?.text.text).toContain('Connection Created');
  });

  it('connection_disconnected includes reason when present', () => {
    const blocks = buildBlocks(makePayload({
      category: 'connection_disconnected',
      severity: 'error',
      metadata: { platform: 'HubSpot', displayName: 'My HubSpot', reason: 'Token revoked' },
    }));
    const reasonSection = blocks.find((b: any) =>
      b.type === 'section' && b.text?.text?.includes('Token revoked'),
    );
    expect(reasonSection).toBeDefined();
  });

  it('execution_quota_exceeded produces quota blocks with danger button', () => {
    const blocks = buildBlocks(makePayload({
      category: 'execution_quota_exceeded',
      severity: 'error',
      metadata: { used: 100, limit: 100 },
      actionUrl: 'http://localhost:5173/settings',
    }));
    const header = blocks.find((b: any) => b.type === 'header');
    expect(header?.text.text).toContain('Execution Limit Reached');
    const actions = blocks.find((b: any) => b.type === 'actions');
    expect(actions?.elements[0].style).toBe('danger');
  });

  it('execution_quota_warning produces quota blocks with percentage', () => {
    const blocks = buildBlocks(makePayload({
      category: 'execution_quota_warning',
      severity: 'warning',
      metadata: { used: 80, limit: 100, pct: 80 },
    }));
    const header = blocks.find((b: any) => b.type === 'header');
    expect(header?.text.text).toContain('Execution Quota Warning');
    const usageSection = blocks.find((b: any) =>
      b.type === 'section' && b.fields?.some((f: any) => f.text.includes('80%')),
    );
    expect(usageSection).toBeDefined();
  });

  it('retry_exhausted produces retry blocks with attempts count', () => {
    const blocks = buildBlocks(makePayload({
      category: 'retry_exhausted',
      severity: 'error',
      metadata: { workflowName: 'Import', instanceId: 'i-5', retryMaxAttempts: 3 },
    }));
    const header = blocks.find((b: any) => b.type === 'header');
    expect(header?.text.text).toContain('All Retries Exhausted');
    const attemptSection = blocks.find((b: any) =>
      b.type === 'section' && b.text?.text?.includes('3'),
    );
    expect(attemptSection).toBeDefined();
  });

  it('rule_error produces rule error blocks with ruleName/failureCount', () => {
    const blocks = buildBlocks(makePayload({
      category: 'rule_error',
      severity: 'error',
      metadata: { ruleName: 'Auto-Assign', failureCount: 5 },
    }));
    const header = blocks.find((b: any) => b.type === 'header');
    expect(header?.text.text).toContain('Automation Rule Error');
    const sections = blocks.filter((b: any) => b.type === 'section');
    const hasRule = sections.some((s: any) =>
      s.fields?.some((f: any) => f.text.includes('Auto-Assign')),
    );
    expect(hasRule).toBe(true);
  });

  it('workflow_synced produces sync blocks with body text', () => {
    const blocks = buildBlocks(makePayload({
      category: 'workflow_synced',
      body: '3 workflows synced from Docusign Maestro.',
    }));
    const header = blocks.find((b: any) => b.type === 'header');
    expect(header?.text.text).toContain('Workflows Synced');
    const bodySection = blocks.find((b: any) =>
      b.type === 'section' && b.text?.text?.includes('3 workflows synced'),
    );
    expect(bodySection).toBeDefined();
  });

  it('unknown category falls back to buildGenericBlocks', () => {
    const blocks = buildBlocks(makePayload({ category: 'unknown_type' }));
    const context = blocks.find((b: any) => b.type === 'context');
    // Generic blocks include category in context
    const contextText = context?.elements?.[0]?.text;
    expect(contextText).toContain('unknown_type');
  });

  it('generic blocks include actionUrl button when present', () => {
    const blocks = buildGenericBlocks(makePayload({
      actionUrl: 'http://localhost:5173/page',
    }));
    const actions = blocks.find((b: any) => b.type === 'actions');
    expect(actions).toBeDefined();
    expect(actions?.elements[0].url).toBe('http://localhost:5173/page');
  });

  it('generic blocks omit actions when actionUrl absent', () => {
    const blocks = buildGenericBlocks(makePayload({ actionUrl: undefined }));
    const actions = blocks.find((b: any) => b.type === 'actions');
    expect(actions).toBeUndefined();
  });

  // ── buildBlocks — missing metadata fallbacks ───────────────

  describe('buildBlocks — missing metadata fallbacks', () => {
    // buildGenericBlocks: unknown severity uses '📢' emoji fallback
    it('generic blocks use 📢 emoji for unknown severity', () => {
      const blocks = buildGenericBlocks(makePayload({ severity: 'critical' as any }));
      const header = blocks.find((b: any) => b.type === 'header');
      expect(header?.text.text).toContain('📢');
    });

    // buildWorkflowLaunchedBlocks
    it('workflow_launched: no metadata → shows "—" fallbacks', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_launched', metadata: undefined }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
      expect(section?.fields[1].text).toContain('—');
    });

    it('workflow_launched: missing workflowName → shows "—"', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_launched', metadata: { instanceId: 'i-1' } }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
    });

    it('workflow_launched: missing instanceName and instanceId → shows "—"', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_launched', metadata: { workflowName: 'W' } }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[1].text).toContain('—');
    });

    it('workflow_launched: missing actionUrl → no View in Baton button', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_launched', metadata: { workflowName: 'W', instanceId: 'i-1' }, actionUrl: undefined }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeUndefined();
    });

    it('workflow_launched: maestroInstanceUrl present but no actionUrl → only Maestro button', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_launched', metadata: { maestroInstanceUrl: 'https://maestro.example.com/i-1' }, actionUrl: undefined }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeDefined();
      expect(actions?.elements).toHaveLength(1);
      expect(actions?.elements[0].text.text).toContain('Maestro');
    });

    // buildWorkflowFailedBlocks
    it('workflow_failed: no metadata → shows "—" fallbacks', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_failed', metadata: undefined }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
    });

    it('workflow_failed: missing errorMessage → no error code block', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_failed', metadata: { workflowName: 'W', errorStep: 'Step 1' } }));
      const errorSection = blocks.find((b: any) =>
        b.type === 'section' && b.text?.text?.includes('```'),
      );
      expect(errorSection).toBeUndefined();
    });

    it('workflow_failed: missing actionUrl and maestroInstanceUrl → no actions block', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_failed', metadata: { workflowName: 'W', instanceId: 'i-1' }, actionUrl: undefined }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeUndefined();
    });

    // buildWorkflowCompletedBlocks
    it('workflow_completed: no metadata → shows "—" fallbacks', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_completed', metadata: undefined }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
    });

    it('workflow_completed: missing actionUrl and maestroInstanceUrl → no actions block', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_completed', metadata: { workflowName: 'W', instanceId: 'i-1' }, actionUrl: undefined }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeUndefined();
    });

    // buildConnectionBlocks
    it('connection_degraded: no metadata → shows "—" fallbacks', () => {
      const blocks = buildBlocks(makePayload({ category: 'connection_degraded', metadata: undefined }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
      expect(section?.fields[1].text).toContain('—');
    });

    it('connection_degraded: missing platform/connectionId → shows "—"', () => {
      const blocks = buildBlocks(makePayload({ category: 'connection_degraded', metadata: {} }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
      expect(section?.fields[1].text).toContain('—');
    });

    it('connection_degraded: missing actionUrl → no actions block', () => {
      const blocks = buildBlocks(makePayload({ category: 'connection_degraded', metadata: { platform: 'Salesforce', connectionId: 'c-1' }, actionUrl: undefined }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeUndefined();
    });

    // buildRuleErrorBlocks
    it('rule_error: no metadata → shows "—" fallbacks', () => {
      const blocks = buildBlocks(makePayload({ category: 'rule_error', metadata: undefined }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
      expect(section?.fields[1].text).toContain('—');
    });

    it('rule_error: missing ruleName/failureCount → shows "—"', () => {
      const blocks = buildBlocks(makePayload({ category: 'rule_error', metadata: {} }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
      expect(section?.fields[1].text).toContain('—');
    });

    it('rule_error: missing actionUrl → no actions block', () => {
      const blocks = buildBlocks(makePayload({ category: 'rule_error', metadata: { ruleName: 'R', failureCount: 1 }, actionUrl: undefined }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeUndefined();
    });

    // buildRetryExhaustedBlocks
    it('retry_exhausted: no metadata → shows "—" fallbacks', () => {
      const blocks = buildBlocks(makePayload({ category: 'retry_exhausted', metadata: undefined }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
      expect(section?.fields[1].text).toContain('—');
    });

    it('retry_exhausted: missing retryMaxAttempts → shows "—"', () => {
      const blocks = buildBlocks(makePayload({ category: 'retry_exhausted', metadata: { workflowName: 'W', instanceId: 'i-1' } }));
      const attemptsSection = blocks.find((b: any) =>
        b.type === 'section' && b.text?.text?.includes('Attempts'),
      );
      expect(attemptsSection?.text.text).toContain('—');
    });

    it('retry_exhausted: missing actionUrl and maestroInstanceUrl → no actions block', () => {
      const blocks = buildBlocks(makePayload({ category: 'retry_exhausted', metadata: { workflowName: 'W', instanceId: 'i-1' }, actionUrl: undefined }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeUndefined();
    });

    // buildQuotaBlocks
    it('execution_quota_exceeded: no metadata → used/limit default to 0', () => {
      const blocks = buildBlocks(makePayload({ category: 'execution_quota_exceeded', metadata: undefined }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('0 / 0');
    });

    it('execution_quota_warning: pct absent → no Usage field', () => {
      const blocks = buildBlocks(makePayload({ category: 'execution_quota_warning', metadata: { used: 80, limit: 100 } }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      const hasUsage = section?.fields?.some((f: any) => f.text.includes('Usage'));
      expect(hasUsage).toBeFalsy();
    });

    it('execution_quota_exceeded: missing actionUrl → no actions block', () => {
      const blocks = buildBlocks(makePayload({ category: 'execution_quota_exceeded', metadata: { used: 100, limit: 100 }, actionUrl: undefined }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeUndefined();
    });

    // buildWorkflowSyncedBlocks
    it('workflow_synced: missing actionUrl → no actions block', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_synced', actionUrl: undefined }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeUndefined();
    });

    it('workflow_synced: actionUrl present → actions block with View Workflows button', () => {
      const blocks = buildBlocks(makePayload({ category: 'workflow_synced', actionUrl: 'http://localhost:5173/workflows' }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeDefined();
      expect(actions?.elements[0].url).toBe('http://localhost:5173/workflows');
    });

    // buildConnectionLifecycleBlocks
    it('connection_created: no metadata → shows "—" fallbacks', () => {
      const blocks = buildBlocks(makePayload({ category: 'connection_created', metadata: undefined }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
      expect(section?.fields[1].text).toContain('—');
    });

    it('connection_created: missing platform/displayName → shows "—"', () => {
      const blocks = buildBlocks(makePayload({ category: 'connection_created', metadata: {} }));
      const section = blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(section?.fields[0].text).toContain('—');
      expect(section?.fields[1].text).toContain('—');
    });

    it('connection_disconnected: with reason → includes reason section', () => {
      const blocks = buildBlocks(makePayload({
        category: 'connection_disconnected',
        metadata: { platform: 'HubSpot', displayName: 'My HubSpot', reason: 'OAuth token expired' },
      }));
      const reasonSection = blocks.find((b: any) =>
        b.type === 'section' && b.text?.text?.includes('OAuth token expired'),
      );
      expect(reasonSection).toBeDefined();
    });

    it('connection_disconnected: missing reason → no reason section', () => {
      const blocks = buildBlocks(makePayload({
        category: 'connection_disconnected',
        metadata: { platform: 'HubSpot', displayName: 'My HubSpot' },
      }));
      const reasonSection = blocks.find((b: any) =>
        b.type === 'section' && b.text?.text?.includes('Reason'),
      );
      expect(reasonSection).toBeUndefined();
    });

    it('connection_created: missing actionUrl → no actions block', () => {
      const blocks = buildBlocks(makePayload({ category: 'connection_created', metadata: { platform: 'HubSpot', displayName: 'My HubSpot' }, actionUrl: undefined }));
      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeUndefined();
    });
  });
});

// ── sendSlackNotification — additional coverage ──────────────

describe('sendSlackNotification — unknown severity', () => {
  it('uses 📢 emoji and gray color for unknown severity', async () => {
    mockSend.mockResolvedValueOnce({ Item: makeConfig({ orgId: 'org-sev-1' }) });
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true, ts: '1.1', channel: '#alerts' }),
    });

    await sendSlackNotification(makePayload({ orgId: 'org-sev-1', severity: 'critical' as any }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachments[0].color).toBe('#6b7280');
    expect(body.text).toContain('📢');
  });
});

// ── resolveChannel — enabled config with empty env default ───

describe('resolveChannel — enabled config, empty SLACK_DEFAULT_CHANNEL', () => {
  it('returns null when config.enabled but routing empty and SLACK_DEFAULT_CHANNEL is empty', async () => {
    const envModule = await import('../../env');
    const originalChannel = envModule.default.SLACK_DEFAULT_CHANNEL;
    envModule.default.SLACK_DEFAULT_CHANNEL = '';

    const config = makeConfig({ channelRouting: { default: '' } });
    const channel = resolveChannel(config, 'general');
    expect(channel).toBeNull();

    envModule.default.SLACK_DEFAULT_CHANNEL = originalChannel;
  });
});

// ── sendSlackNotification — integration ─────────────────────

describe('sendSlackNotification', () => {
  it('loads config, resolves token/channel, posts message on success', async () => {
    mockSend.mockResolvedValueOnce({ Item: makeConfig({ orgId: 'org-send-1' }) });
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true, ts: '123.456', channel: '#alerts' }),
    });

    await sendSlackNotification(makePayload({ orgId: 'org-send-1' }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(logInfo).toHaveBeenCalledWith(
      'Slack notification sent',
      expect.objectContaining({ orgId: 'org-send-1', channel: '#alerts' }),
    );
  });

  it('skips silently when org has no connected workspace', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // no config

    await sendSlackNotification(makePayload({ orgId: 'org-notoken-1' }));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logDebug).toHaveBeenCalledWith(
      'Slack bot token not configured, skipping',
      expect.any(Object),
    );
  });

  it('skips silently when no channel resolved', async () => {
    // Config enabled but routing has no matching channel and env default is empty
    const envModule = await import('../../env');
    const originalChannel = envModule.default.SLACK_DEFAULT_CHANNEL;
    envModule.default.SLACK_DEFAULT_CHANNEL = '';

    mockSend.mockResolvedValueOnce({
      Item: makeConfig({ orgId: 'org-nochan-1', channelRouting: { default: '' } }),
    });

    await sendSlackNotification(makePayload({ orgId: 'org-nochan-1' }));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logDebug).toHaveBeenCalledWith(
      'No Slack channel configured for category, skipping',
      expect.any(Object),
    );

    envModule.default.SLACK_DEFAULT_CHANNEL = originalChannel;
  });

  it('logs warning when Slack API returns ok: false', async () => {
    mockSend.mockResolvedValueOnce({ Item: makeConfig({ orgId: 'org-apifail-1' }) });
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: false, error: 'invalid_auth' }),
    });

    await sendSlackNotification(makePayload({ orgId: 'org-apifail-1' }));

    expect(logWarn).toHaveBeenCalledWith(
      'Slack notification failed',
      expect.objectContaining({ error: 'invalid_auth' }),
    );
  });

  it('catches fetch errors and logs them without throwing', async () => {
    mockSend.mockResolvedValueOnce({ Item: makeConfig({ orgId: 'org-fetcherr-1' }) });
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw
    await sendSlackNotification(makePayload({ orgId: 'org-fetcherr-1' }));

    expect(logError).toHaveBeenCalledWith(
      'Slack notification error',
      expect.any(Error),
      expect.objectContaining({ orgId: 'org-fetcherr-1' }),
    );
  });
});

// ── verifySlackSignature ────────────────────────────────────

describe('verifySlackSignature', () => {
  const signingSecret = 'test-signing-secret';
  const rawBody = Buffer.from('{"event":"test"}');
  const timestamp = String(Math.floor(Date.now() / 1000));

  function computeSignature(secret: string, ts: string, body: Buffer): string {
    const baseString = `v0:${ts}:${body.toString('utf8')}`;
    const hmac = crypto.createHmac('sha256', secret).update(baseString).digest('hex');
    return `v0=${hmac}`;
  }

  it('returns true for valid HMAC-SHA256 signature', () => {
    const sig = computeSignature(signingSecret, timestamp, rawBody);
    expect(verifySlackSignature(signingSecret, rawBody, timestamp, sig)).toBe(true);
  });

  it('returns false for tampered body', () => {
    const sig = computeSignature(signingSecret, timestamp, rawBody);
    const tampered = Buffer.from('{"event":"hacked"}');
    expect(verifySlackSignature(signingSecret, tampered, timestamp, sig)).toBe(false);
  });

  it('returns false for wrong signing secret', () => {
    const sig = computeSignature(signingSecret, timestamp, rawBody);
    expect(verifySlackSignature('wrong-secret', rawBody, timestamp, sig)).toBe(false);
  });

  it('returns false when timestamp is older than 5 minutes (replay attack)', () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400);
    const sig = computeSignature(signingSecret, oldTimestamp, rawBody);
    expect(verifySlackSignature(signingSecret, rawBody, oldTimestamp, sig)).toBe(false);
  });

  it('returns false when provided signature has different length than expected (buf1.length !== buf2.length)', () => {
    // A signature with a different byte length will never be equal
    const shortSig = 'v0=abc123';
    expect(verifySlackSignature(signingSecret, rawBody, timestamp, shortSig)).toBe(false);
  });
});

// ── handleAppMention ────────────────────────────────────────

describe('handleAppMention', () => {
  const baseEvent = {
    type: 'app_mention' as const,
    user: 'U123',
    channel: '#general',
    ts: '123.456',
    team: 'T123',
  };

  it('"status" command replies with running status', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true }),
    });

    await handleAppMention('xoxb-token', { ...baseEvent, text: '<@U999> status' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain('Baton is running');
  });

  it('"help" command replies with command list', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true }),
    });

    await handleAppMention('xoxb-token', { ...baseEvent, text: '<@U999> help' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain('commands');
  });

  it('unrecognized command replies with help hint', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true }),
    });

    await handleAppMention('xoxb-token', { ...baseEvent, text: '<@U999> foobar' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("don't recognize");
  });

  it('strips bot mention tags from text before parsing command', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true }),
    });

    await handleAppMention('xoxb-token', { ...baseEvent, text: '<@U123ABC> <@UOTHER> status' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain('Baton is running');
  });
});
