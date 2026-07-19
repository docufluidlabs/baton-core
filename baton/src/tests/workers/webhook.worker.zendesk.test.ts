/**
 * Webhook Worker — Zendesk normalization test — Baton
 *
 * Proves the production path: a stored Zendesk webhook event is normalized by
 * the REAL ZendeskConnector (registered in the connector registry) into a
 * specific `eventType` (e.g. `ticket.created`) before it reaches the rule
 * engine. Connectors are intentionally NOT mocked here — that's the point.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetWebhookEvent, mockMarkProcessed, mockProcessEvent } = vi.hoisted(() => ({
  mockGetWebhookEvent: vi.fn(),
  mockMarkProcessed: vi.fn(),
  mockProcessEvent: vi.fn(),
}));

// Logger mock MUST expose createLogger() returning a logger object.
vi.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
}));
vi.mock('../../services/webhook-event.service', () => ({
  getWebhookEvent: mockGetWebhookEvent,
  markProcessed: mockMarkProcessed,
}));
vi.mock('../../services/rule-engine.service', () => ({
  processEvent: mockProcessEvent,
}));
// NOTE: connectors are NOT mocked — the real ZendeskConnector runs.

import { processWebhookJob } from '../../workers/webhook.worker';

const baseJob = {
  eventId: 'evt-z', platform: 'zendesk' as const, orgId: 'org-z',
  connectionId: 'app-z', requestId: 'req-z', ruleId: 'rule-z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkProcessed.mockResolvedValue(undefined);
  mockProcessEvent.mockResolvedValue({ eventType: 'ticket.created', matchedRules: 1, launchedWorkflows: 1 });
});

describe('processWebhookJob — Zendesk', () => {
  it('normalizes an Event-subscription payload to ticket.created via the real connector', async () => {
    mockGetWebhookEvent.mockResolvedValue({
      id: 'evt-z',
      processed: false,
      payload: { type: 'zen:event-type:ticket.created', detail: { id: '42' }, account_id: 7 },
    });

    await processWebhookJob(baseJob);

    expect(mockProcessEvent).toHaveBeenCalledTimes(1);
    const arg = mockProcessEvent.mock.calls[0][0];
    expect(arg.platform).toBe('zendesk');
    expect(arg.eventInfo.eventType).toBe('ticket.created');
    expect(arg.eventInfo.recordId).toBe('42');
    expect(arg.ruleId).toBe('rule-z');
    expect(mockMarkProcessed).toHaveBeenCalledWith('evt-z');
  });

  it('normalizes ticket.solved (distinct from created — drives event-specific matching)', async () => {
    mockGetWebhookEvent.mockResolvedValue({
      id: 'evt-z', processed: false,
      payload: { type: 'zen:event-type:ticket.solved', detail: { id: '99' } },
    });

    await processWebhookJob(baseJob);

    expect(mockProcessEvent.mock.calls[0][0].eventInfo.eventType).toBe('ticket.solved');
  });

  it('skips an already-processed event (idempotency)', async () => {
    mockGetWebhookEvent.mockResolvedValue({
      id: 'evt-z', processed: true, error: undefined,
      payload: { type: 'zen:event-type:ticket.created' },
    });

    await processWebhookJob(baseJob);

    expect(mockProcessEvent).not.toHaveBeenCalled();
    expect(mockMarkProcessed).not.toHaveBeenCalled();
  });

  it('returns early when the event is not found', async () => {
    mockGetWebhookEvent.mockResolvedValue(null);

    await processWebhookJob(baseJob);

    expect(mockProcessEvent).not.toHaveBeenCalled();
  });
});
