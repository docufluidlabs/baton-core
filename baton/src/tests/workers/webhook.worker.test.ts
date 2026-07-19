import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processWebhookJob } from '../../workers/webhook.worker';

vi.mock('../../lib/logger', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));
vi.mock('../../lib/types', () => ({}));

const mockGetWebhookEvent = vi.fn();
const mockMarkProcessed = vi.fn();
vi.mock('../../services/webhook-event.service', () => ({
  getWebhookEvent: (...args: any[]) => mockGetWebhookEvent(...args),
  markProcessed: (...args: any[]) => mockMarkProcessed(...args),
}));

const mockExtractEventInfo = vi.fn();
const mockHasConnector = vi.fn();
vi.mock('../../services/connectors', () => ({
  getConnector: vi.fn(() => ({ extractEventInfo: mockExtractEventInfo })),
  hasConnector: (...args: any[]) => mockHasConnector(...args),
}));

const mockProcessEvent = vi.fn();
vi.mock('../../services/rule-engine.service', () => ({
  processEvent: (...args: any[]) => mockProcessEvent(...args),
}));

// ─── Helpers ─────────────────────────────────────────────────

function makeJob() {
  return {
    eventId: 'evt-1',
    platform: 'procore' as const,
    orgId: 'org-1',
    connectionId: 'conn-1',
  };
}

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    id: 'evt-1',
    platform: 'procore',
    payload: { resource: 'vendors', action: 'create', data: { id: 42 } },
    processed: false,
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEventInfo(overrides: Record<string, any> = {}) {
  return {
    eventType: 'vendor.created',
    eventLabel: 'Vendor Created',
    actingUserEmail: 'alice@test.com',
    summary: 'Vendor #42 created',
    ...overrides,
  };
}

function makeProcessResult(overrides: Record<string, any> = {}) {
  return {
    eventType: 'vendor.created',
    matchedRules: 2,
    launchedWorkflows: 1,
    pipelineEntries: ['pe-1'],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processWebhookJob', () => {
  it('returns early with a warning when event is not found', async () => {
    mockGetWebhookEvent.mockResolvedValue(null);

    await processWebhookJob(makeJob());

    expect(mockGetWebhookEvent).toHaveBeenCalledWith('evt-1');
    expect(mockMarkProcessed).not.toHaveBeenCalled();
    expect(mockProcessEvent).not.toHaveBeenCalled();

    const { logWarn } = await import('../../lib/logger');
    expect(logWarn).toHaveBeenCalledWith(
      'Webhook event not found, skipping',
      expect.objectContaining({ eventId: 'evt-1' }),
    );
  });

  it('uses generic extraction when no connector exists for platform (app-based)', async () => {
    const event = makeEvent({ payload: { event_type: 'vendor.created', summary: 'New vendor', user_email: 'bob@test.com', record_id: '99' } });
    const result = makeProcessResult();

    mockGetWebhookEvent.mockResolvedValue(event);
    mockHasConnector.mockReturnValue(false);
    mockProcessEvent.mockResolvedValue(result);
    mockMarkProcessed.mockResolvedValue(undefined);

    await processWebhookJob(makeJob());

    expect(mockExtractEventInfo).not.toHaveBeenCalled();
    expect(mockProcessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventInfo: expect.objectContaining({
          eventType: 'vendor.created',
          summary: 'New vendor',
          actingUserEmail: 'bob@test.com',
          recordId: '99',
        }),
      }),
    );
    expect(mockMarkProcessed).toHaveBeenCalledWith('evt-1');
  });

  it('happy path: extracts event info, processes event, and marks processed', async () => {
    const event = makeEvent();
    const eventInfo = makeEventInfo();
    const result = makeProcessResult();

    mockGetWebhookEvent.mockResolvedValue(event);
    mockHasConnector.mockReturnValue(true);
    mockExtractEventInfo.mockReturnValue(eventInfo);
    mockProcessEvent.mockResolvedValue(result);
    mockMarkProcessed.mockResolvedValue(undefined);

    await processWebhookJob(makeJob());

    expect(mockExtractEventInfo).toHaveBeenCalledTimes(1);
    expect(mockProcessEvent).toHaveBeenCalledTimes(1);
    expect(mockMarkProcessed).toHaveBeenCalledWith('evt-1');
  });

  it('passes the correct payload to extractEventInfo', async () => {
    const event = makeEvent({ payload: { custom: 'data' } });
    mockGetWebhookEvent.mockResolvedValue(event);
    mockHasConnector.mockReturnValue(true);
    mockExtractEventInfo.mockReturnValue(makeEventInfo());
    mockProcessEvent.mockResolvedValue(makeProcessResult());
    mockMarkProcessed.mockResolvedValue(undefined);

    await processWebhookJob(makeJob());

    expect(mockExtractEventInfo).toHaveBeenCalledWith({ custom: 'data' });
  });

  it('passes correct arguments to ruleEngine.processEvent', async () => {
    const event = makeEvent();
    const eventInfo = makeEventInfo();
    mockGetWebhookEvent.mockResolvedValue(event);
    mockHasConnector.mockReturnValue(true);
    mockExtractEventInfo.mockReturnValue(eventInfo);
    mockProcessEvent.mockResolvedValue(makeProcessResult());
    mockMarkProcessed.mockResolvedValue(undefined);

    await processWebhookJob(makeJob());

    expect(mockProcessEvent).toHaveBeenCalledWith({
      orgId: 'org-1',
      connectionId: 'conn-1',
      platform: 'procore',
      eventInfo,
      rawPayload: event.payload,
      webhookEventId: 'evt-1',
    });
  });

  it('logs matchedRules and launchedWorkflows from processEvent result', async () => {
    const result = makeProcessResult({ matchedRules: 3, launchedWorkflows: 2 });
    mockGetWebhookEvent.mockResolvedValue(makeEvent());
    mockHasConnector.mockReturnValue(true);
    mockExtractEventInfo.mockReturnValue(makeEventInfo());
    mockProcessEvent.mockResolvedValue(result);
    mockMarkProcessed.mockResolvedValue(undefined);

    await processWebhookJob(makeJob());

    const { logInfo } = await import('../../lib/logger');
    expect(logInfo).toHaveBeenCalledWith(
      'Webhook event fully processed',
      expect.objectContaining({
        matchedRules: 3,
        launchedWorkflows: 2,
      }),
    );
  });

  it('marks processed with eventId only (no error) in happy path', async () => {
    mockGetWebhookEvent.mockResolvedValue(makeEvent());
    mockHasConnector.mockReturnValue(true);
    mockExtractEventInfo.mockReturnValue(makeEventInfo());
    mockProcessEvent.mockResolvedValue(makeProcessResult());
    mockMarkProcessed.mockResolvedValue(undefined);

    await processWebhookJob(makeJob());

    expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
    expect(mockMarkProcessed).toHaveBeenCalledWith('evt-1');
  });

  it('marks processed with error message and re-throws on failure', async () => {
    const error = new Error('Rule engine exploded');
    mockGetWebhookEvent.mockResolvedValue(makeEvent());
    mockHasConnector.mockReturnValue(true);
    mockExtractEventInfo.mockReturnValue(makeEventInfo());
    mockProcessEvent.mockRejectedValue(error);
    mockMarkProcessed.mockResolvedValue(undefined);

    await expect(processWebhookJob(makeJob())).rejects.toThrow('Rule engine exploded');

    expect(mockMarkProcessed).toHaveBeenCalledWith('evt-1', 'Rule engine exploded');
  });
});
