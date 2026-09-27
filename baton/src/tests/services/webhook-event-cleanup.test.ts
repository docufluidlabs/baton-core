/**
 * Webhook Event Cleanup Tests — Baton
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScanCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const { mockSend, mockGetAppTemplate, mockLogWarn, mockLogInfo } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetAppTemplate: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogInfo: vi.fn(),
}));

vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: (cmd: any) => mockSend(cmd) }),
  TableNames: { WEBHOOK_EVENTS: 'baton-webhook-events' },
}));
vi.mock('../../lib/app-catalog', () => ({ getAppTemplate: mockGetAppTemplate }));
vi.mock('../../lib/logger', () => ({
  logInfo: mockLogInfo, logWarn: mockLogWarn, logError: vi.fn(), logDebug: vi.fn(),
}));

import { cleanupWebhookEvents, resetCleanupCursor, EVENT_RETENTION_DAYS } from '../../services/webhook-event-cleanup';

const NOW = Date.parse('2026-09-01T03:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

/** Serve the table as pages; record deletes and updates. */
function table(pages: Record<string, any>[][]) {
  const deleted: string[] = [];
  const updated: Record<string, any> = {};
  const scans: any[] = [];

  mockSend.mockImplementation((cmd: any) => {
    if (cmd instanceof ScanCommand) {
      scans.push(cmd.input);
      const start = cmd.input.ExclusiveStartKey as { page: number } | undefined;
      const index = start ? start.page : 0;
      const hasMore = index + 1 < pages.length;
      return Promise.resolve({
        Items: pages[index] ?? [],
        LastEvaluatedKey: hasMore ? { page: index + 1 } : undefined,
      });
    }
    if (cmd instanceof DeleteCommand) {
      deleted.push(cmd.input.Key!.id);
      return Promise.resolve({});
    }
    if (cmd instanceof UpdateCommand) {
      updated[cmd.input.Key!.id] = cmd.input;
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });

  return { deleted, updated, scans };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCleanupCursor();
  mockGetAppTemplate.mockReturnValue(undefined);
});

describe('cleanupWebhookEvents — retention', () => {
  it('deletes processed events older than the retention period', async () => {
    const t = table([[
      { id: 'old-done', receivedAt: daysAgo(EVENT_RETENTION_DAYS + 1), processed: true },
      { id: 'recent-done', receivedAt: daysAgo(EVENT_RETENTION_DAYS - 1), processed: true },
    ]]);

    const result = await cleanupWebhookEvents(NOW);

    expect(t.deleted).toEqual(['old-done']);
    expect(result).toMatchObject({ examined: 2, deleted: 1, scrubbed: 0, failed: 0, completed: true });
  });

  it('keeps old events that were never processed', async () => {
    const t = table([[
      { id: 'old-pending', receivedAt: daysAgo(90), processed: false },
      { id: 'old-unknown', receivedAt: daysAgo(90) },
    ]]);

    await cleanupWebhookEvents(NOW);

    expect(t.deleted).toEqual([]);
  });

  it('deletes idempotency markers of that age, which carry createdAt and no processed flag', async () => {
    const t = table([[
      { id: 'dedup#777:Deals:insert:1', platform: 'zohocrm', createdAt: daysAgo(45) },
      { id: 'dedup#777:Deals:insert:2', platform: 'zohocrm', createdAt: daysAgo(2) },
    ]]);

    await cleanupWebhookEvents(NOW);

    expect(t.deleted).toEqual(['dedup#777:Deals:insert:1']);
  });

  it('reaches old events beyond the first page of the table', async () => {
    const firstPage = Array.from({ length: 200 }, (_, i) => ({
      id: `recent-${i}`, receivedAt: daysAgo(1), processed: true,
    }));
    const t = table([
      firstPage,
      [{ id: 'old-on-page-2', receivedAt: daysAgo(60), processed: true }],
      [{ id: 'old-on-page-3', receivedAt: daysAgo(61), processed: true }],
    ]);

    const result = await cleanupWebhookEvents(NOW);

    expect(t.deleted).toEqual(['old-on-page-2', 'old-on-page-3']);
    expect(result).toMatchObject({ examined: 202, deleted: 2, completed: true });
  });

  it('scans without a filter and without fetching payloads', async () => {
    const t = table([[]]);

    await cleanupWebhookEvents(NOW);

    expect(t.scans[0].FilterExpression).toBeUndefined();
    expect(t.scans[0].ProjectionExpression).not.toContain('payload');
    expect(t.scans[0].Limit).toBe(200);
  });
});

describe('cleanupWebhookEvents — a bounded walk', () => {
  const page = (n: number) => [{ id: `e-${n}`, receivedAt: daysAgo(1), processed: true }];

  it('stops after its page budget and resumes there on the next run', async () => {
    const t = table(Array.from({ length: 150 }, (_, i) => page(i)));

    const first = await cleanupWebhookEvents(NOW);
    expect(first).toMatchObject({ examined: 100, completed: false });
    expect(t.scans).toHaveLength(100);

    const second = await cleanupWebhookEvents(NOW);
    expect(second).toMatchObject({ examined: 50, completed: true });
    expect(t.scans[100].ExclusiveStartKey).toEqual({ page: 100 });
  });

  it('starts over once it has reached the end', async () => {
    const t = table([page(0), page(1)]);

    await cleanupWebhookEvents(NOW);
    await cleanupWebhookEvents(NOW);

    expect(t.scans).toHaveLength(4);
    expect(t.scans[2].ExclusiveStartKey).toBeUndefined();
  });
});

describe('cleanupWebhookEvents — events stored with their credentials', () => {
  it('masks the credentials in place and leaves the rest of the event alone', async () => {
    const t = table([[{
      id: 'evt-1',
      platform: 'zohocrm',
      receivedAt: daysAgo(3),
      processed: true,
      headers: {
        authorization: 'Basic ' + Buffer.from('baton-zoho:hunter2-hunter2').toString('base64'),
        'x-api-key': 'endpoint-key-123',
        'content-type': 'application/json',
      },
    }]]);

    const result = await cleanupWebhookEvents(NOW);

    const update = t.updated['evt-1'];
    expect(update.UpdateExpression).toBe('SET #headers = :headers');
    expect(update.ConditionExpression).toBe('attribute_exists(id)');
    expect(update.ExpressionAttributeValues[':headers']).toEqual({
      authorization: 'Basic [REDACTED]',
      'x-api-key': '[REDACTED]',
      'content-type': 'application/json',
    });
    expect(JSON.stringify(update)).not.toContain('hunter2');
    expect(JSON.stringify(update)).not.toContain('endpoint-key-123');
    expect(t.deleted).toEqual([]);
    expect(result).toMatchObject({ scrubbed: 1, deleted: 0 });
  });

  it('masks the static token header named by the platform template', async () => {
    mockGetAppTemplate.mockReturnValue({
      verificationMethod: { type: 'static_token', headerName: 'X-Shared-Value' },
    });
    const t = table([[{
      id: 'evt-2', platform: 'airtable', receivedAt: daysAgo(3), processed: true,
      headers: { 'x-shared-value': 'static-abc', 'user-agent': 'Airtable' },
    }]]);

    await cleanupWebhookEvents(NOW);

    expect(t.updated['evt-2'].ExpressionAttributeValues[':headers']).toEqual({
      'x-shared-value': '[REDACTED]', 'user-agent': 'Airtable',
    });
  });

  it('does not rewrite an event that is already clean', async () => {
    const t = table([[
      {
        id: 'evt-clean', platform: 'zendesk', receivedAt: daysAgo(3), processed: true,
        headers: { 'x-zendesk-webhook-signature': 'c2ln', authorization: 'Basic [REDACTED]' },
      },
      { id: 'evt-no-headers', platform: 'docusign', receivedAt: daysAgo(3), processed: true },
    ]]);

    const result = await cleanupWebhookEvents(NOW);

    expect(t.updated).toEqual({});
    expect(result).toMatchObject({ examined: 2, scrubbed: 0, deleted: 0 });
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it('deletes an expired event rather than scrubbing it', async () => {
    const t = table([[{
      id: 'evt-old', platform: 'zohocrm', receivedAt: daysAgo(40), processed: true,
      headers: { authorization: 'Basic abc' },
    }]]);

    await cleanupWebhookEvents(NOW);

    expect(t.deleted).toEqual(['evt-old']);
    expect(t.updated).toEqual({});
  });

  it('scrubs an old event it keeps because it was never processed', async () => {
    const t = table([[{
      id: 'evt-old-pending', platform: 'zohocrm', receivedAt: daysAgo(40), processed: false,
      headers: { authorization: 'Basic abc' },
    }]]);

    await cleanupWebhookEvents(NOW);

    expect(t.deleted).toEqual([]);
    expect(t.updated['evt-old-pending'].ExpressionAttributeValues[':headers'])
      .toEqual({ authorization: 'Basic [REDACTED]' });
  });
});

describe('cleanupWebhookEvents — failures', () => {
  it('carries on past an event it cannot process, and reports it', async () => {
    const t = table([[
      { id: 'old-1', receivedAt: daysAgo(40), processed: true },
      { id: 'old-2', receivedAt: daysAgo(40), processed: true },
    ]]);
    const serve = mockSend.getMockImplementation()!;
    mockSend.mockImplementation((cmd: any) =>
      cmd instanceof DeleteCommand && cmd.input.Key!.id === 'old-1'
        ? Promise.reject(new Error('throttled'))
        : serve(cmd),
    );

    const result = await cleanupWebhookEvents(NOW);

    expect(t.deleted).toEqual(['old-2']);
    expect(result).toMatchObject({ examined: 2, deleted: 1, failed: 1, completed: true });
    expect(mockLogWarn).toHaveBeenCalledOnce();
  });

  it('lets a failed scan reach the scheduler, which logs it', async () => {
    mockSend.mockRejectedValue(new Error('table unavailable'));

    await expect(cleanupWebhookEvents(NOW)).rejects.toThrow('table unavailable');
  });
});
