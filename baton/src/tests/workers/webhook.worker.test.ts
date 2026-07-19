import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processWebhookJob } from '../../workers/webhook.worker';

// The worker uses createLogger() to build a child logger with bound context
// (worker, eventId, platform, orgId, requestId); log lines go through that child.
const { mockLog, mockCreateLogger } = vi.hoisted(() => {
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { mockLog, mockCreateLogger: vi.fn(() => mockLog) };
});

vi.mock('../../lib/logger', () => ({
  createLogger: mockCreateLogger,
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));
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

    // eventId is bound onto the child logger at creation
    expect(mockCreateLogger).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-1' }),
    );
    expect(mockLog.warn).toHaveBeenCalledWith('Webhook event not found, skipping');
  });

  it('skips duplicate delivery when event is already processed without error (idempotency guard)', async () => {
    mockGetWebhookEvent.mockResolvedValue(makeEvent({ processed: true }));

    await processWebhookJob(makeJob());

    expect(mockProcessEvent).not.toHaveBeenCalled();
    expect(mockMarkProcessed).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'Webhook event already processed, skipping duplicate delivery',
    );
  });

  it('re-processes an event that was processed with an error', async () => {
    mockGetWebhookEvent.mockResolvedValue(makeEvent({ processed: true, error: 'previous failure' }));
    mockHasConnector.mockReturnValue(true);
    mockExtractEventInfo.mockReturnValue(makeEventInfo());
    mockProcessEvent.mockResolvedValue(makeProcessResult());
    mockMarkProcessed.mockResolvedValue(undefined);

    await processWebhookJob(makeJob());

    expect(mockProcessEvent).toHaveBeenCalledTimes(1);
    expect(mockMarkProcessed).toHaveBeenCalledWith('evt-1');
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
      requestId: undefined,
      ruleId: undefined,
      sfDispatchId: undefined,
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

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        matchedRules: 3,
        launchedWorkflows: 2,
      }),
      'Webhook event fully processed',
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

  it('does NOT mark processed and re-throws on failure so SQS can retry', async () => {
    const error = new Error('Rule engine exploded');
    mockGetWebhookEvent.mockResolvedValue(makeEvent());
    mockHasConnector.mockReturnValue(true);
    mockExtractEventInfo.mockReturnValue(makeEventInfo());
    mockProcessEvent.mockRejectedValue(error);
    mockMarkProcessed.mockResolvedValue(undefined);

    await expect(processWebhookJob(makeJob())).rejects.toThrow('Rule engine exploded');

    // Marking processed on failure would make the retry a no-op (idempotency
    // guard would skip it) — the worker must leave the event unprocessed.
    expect(mockMarkProcessed).not.toHaveBeenCalled();
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error }),
      'Webhook processing failed',
    );
  });
});
