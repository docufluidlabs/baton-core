/**
 * Bulk Upload dispatcher tests — batch.service.dispatchDueBatchRuns
 * Verifies: conditional queued→launching update (double-release guard),
 * launch jobs enqueued with batch metadata, nextReleaseAt advanced by the
 * interval, stop-after-consecutive-failures, and run completion detection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: mockSend }),
  TableNames: {
    BATCH_PROCESSORS: 'batch-processors',
    BATCH_RUNS: 'batch-runs',
    BATCH_ROWS: 'batch-rows',
    WORKFLOW_INSTANCES: 'instances',
  },
}));

const { mockSendMessage } = vi.hoisted(() => ({ mockSendMessage: vi.fn() }));
vi.mock('../../queue/sqs-client', () => ({
  sendMessage: mockSendMessage,
  QueueNames: { WORKFLOW_LAUNCHER: 'workflow-launcher' },
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { dispatchDueBatchRuns } from '../../services/batch.service';
import { BatchRow, BatchRun } from '../../lib/types';

// ─── Fixtures ───────────────────────────────────────────────

const processor = {
  id: 'bp-1',
  orgId: 'org-1',
  name: 'Bulk contacts',
  targetWorkflowId: 'wf-1',
  sourcePlatform: 'salesforce',
  status: 'active',
  throttleReleaseCount: 5,
  throttleIntervalMinutes: 10,
  stopAfterConsecutiveFailures: 5,
};

function makeRun(overrides: Partial<BatchRun> = {}): BatchRun {
  return {
    id: 'run-1',
    orgId: 'org-1',
    batchProcessorId: 'bp-1',
    runNumber: 1,
    fileName: 'contacts.csv',
    fileType: 'csv',
    columns: ['Name', 'Email'],
    totalRows: 3,
    status: 'running',
    mapping: {
      customerName: { type: 'column', column: 'Name' },
      customerEmail: { type: 'column', column: 'Email' },
    },
    settings: { releaseCount: 2, intervalMinutes: 10, stopAfterFailures: 5 },
    selectedRows: 3,
    consecutiveFailures: 0,
    nextReleaseAt: new Date(Date.now() - 1000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeQueuedRow(rowNumber: number, seq: number, data: Record<string, string>): BatchRow {
  return {
    runId: 'run-1',
    rowNumber,
    orgId: 'org-1',
    batchProcessorId: 'bp-1',
    data,
    included: true,
    problems: [],
    status: 'queued',
    seq,
  };
}

/**
 * Routes mockSend calls by command type + table so the test does not depend
 * on exact call ordering. Handlers can be overridden per test.
 */
interface MockDb {
  run: BatchRun;
  queuedRows: BatchRow[];
  allRows: BatchRow[];
  instances: Record<string, any>;
  /** rowNumber values for which the conditional queued→launching update fails */
  conditionalFailRows?: number[];
  /** Extra runs returned by the per-processor runs query (legacy promotion's
   *  paused-sibling check). db.run is always included. */
  siblingRuns?: BatchRun[];
  /** Merged over the base processor fixture (e.g. maxUnfinishedInstances). */
  processorOverrides?: Record<string, any>;
}

function installMockDb(db: MockDb) {
  mockSend.mockImplementation(async (cmd: any) => {
    const name = cmd.constructor.name;
    const input = cmd.input;

    if (name === 'ScanCommand' && input.TableName === 'batch-runs') {
      // Status-aware: the dispatcher scans 'running', the legacy-promotion
      // shim 'queued', and the stale-launching sweep 'paused'/'stopped'.
      const wanted = input.ExpressionAttributeValues?.[':status'];
      return { Items: db.run.status === wanted ? [db.run] : [] };
    }
    if (name === 'GetCommand' && input.TableName === 'batch-processors') {
      return { Item: { ...processor, ...db.processorOverrides } };
    }
    if (name === 'QueryCommand' && input.TableName === 'batch-runs') {
      return { Items: [db.run, ...(db.siblingRuns ?? [])] };
    }
    if (name === 'QueryCommand' && input.TableName === 'batch-rows') {
      // Route by the filter's status values: the release query filters on
      // ':queued', the cap counter on ':launching' + ':launched', the sweep
      // on ':launching' alone; the full-partition query has no filter.
      const v = input.ExpressionAttributeValues ?? {};
      if (v[':queued']) return { Items: db.queuedRows };
      if (v[':launching'] && v[':launched']) {
        return { Items: db.allRows.filter((r) => r.status === 'launching' || r.status === 'launched') };
      }
      if (v[':launching']) {
        return { Items: db.allRows.filter((r) => r.status === 'launching') };
      }
      return { Items: db.allRows };
    }
    if (name === 'UpdateCommand' && input.TableName === 'instances') {
      return {};
    }
    if (name === 'UpdateCommand' && input.TableName === 'batch-rows') {
      const isReleaseGuard = input.ConditionExpression === '#st = :queued';
      if (isReleaseGuard && db.conditionalFailRows?.includes(input.Key.rowNumber)) {
        const err: any = new Error('The conditional request failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      return {};
    }
    if (name === 'UpdateCommand' && input.TableName === 'batch-runs') {
      return {};
    }
    if (name === 'BatchGetCommand') {
      const keys = input.RequestItems['instances'].Keys as { id: string }[];
      return { Responses: { instances: keys.map((k) => db.instances[k.id]).filter(Boolean) } };
    }
    throw new Error(`Unexpected command in test: ${name} ${input.TableName ?? ''}`);
  });
}

function updateCalls(table: string): any[] {
  return mockSend.mock.calls
    .map(([cmd]) => cmd)
    .filter((cmd) => cmd.constructor.name === 'UpdateCommand' && cmd.input.TableName === table)
    .map((cmd) => cmd.input);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessage.mockResolvedValue('msg-1');
});

// ─── Tests ──────────────────────────────────────────────────

describe('dispatchDueBatchRuns — release', () => {
  it('releases up to releaseCount queued rows with the conditional guard and enqueues launch jobs', async () => {
    installMockDb({
      run: makeRun(),
      queuedRows: [
        makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' }),
        makeQueuedRow(2, 2, { Name: 'Bob', Email: 'b@x.com' }),
      ],
      allRows: [],
      instances: {},
    });

    await dispatchDueBatchRuns();

    // Conditional queued→launching update for each released row
    const guards = updateCalls('batch-rows').filter((u) => u.ConditionExpression === '#st = :queued');
    expect(guards).toHaveLength(2);
    expect(guards[0].Key).toEqual({ runId: 'run-1', rowNumber: 1 });
    expect(guards[0].ExpressionAttributeValues[':launching']).toBe('launching');

    // One launch job per row, with batch metadata + mapped inputs + row name
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenCalledWith('workflow-launcher', expect.objectContaining({
      workflowId: 'wf-1',
      orgId: 'org-1',
      inputData: { customerName: 'Alice', customerEmail: 'a@x.com' },
      instanceName: '1 · Alice · row 1',
      batch: expect.objectContaining({ runId: 'run-1', rowNumber: 1, runNumber: 1 }),
    }));
    expect(mockSendMessage).toHaveBeenCalledWith('workflow-launcher', expect.objectContaining({
      batch: expect.objectContaining({ runId: 'run-1', rowNumber: 2 }),
    }));
  });

  it('advances nextReleaseAt by intervalMinutes', async () => {
    installMockDb({
      run: makeRun(),
      queuedRows: [makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' })],
      allRows: [],
      instances: {},
    });

    const before = Date.now();
    await dispatchDueBatchRuns();

    const nextUpdate = updateCalls('batch-runs').find((u) => u.UpdateExpression.includes('nextReleaseAt'));
    expect(nextUpdate).toBeDefined();
    const next = new Date(nextUpdate.ExpressionAttributeValues[':next']).getTime();
    // ~10 minutes out (allow a small execution window)
    expect(next).toBeGreaterThanOrEqual(before + 9.9 * 60_000);
    expect(next).toBeLessThanOrEqual(Date.now() + 10.1 * 60_000);
  });

  it('skips a row whose conditional update fails (double-release guard)', async () => {
    installMockDb({
      run: makeRun(),
      queuedRows: [
        makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' }),
        makeQueuedRow(2, 2, { Name: 'Bob', Email: 'b@x.com' }),
      ],
      allRows: [],
      instances: {},
      conditionalFailRows: [1],
    });

    await dispatchDueBatchRuns();

    // Row 1 lost the race — only row 2 gets a launch job
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith('workflow-launcher', expect.objectContaining({
      batch: expect.objectContaining({ runId: 'run-1', rowNumber: 2 }),
    }));
  });
});

describe('dispatchDueBatchRuns — stop after failures', () => {
  it('stops the run instead of releasing when consecutiveFailures reaches the limit', async () => {
    installMockDb({
      run: makeRun({ consecutiveFailures: 5 }),
      queuedRows: [makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' })],
      allRows: [],
      instances: {},
    });

    await dispatchDueBatchRuns();

    expect(mockSendMessage).not.toHaveBeenCalled();
    const stopUpdate = updateCalls('batch-runs').find(
      (u) => u.ExpressionAttributeValues?.[':stopped'] === 'stopped',
    );
    expect(stopUpdate).toBeDefined();
    expect(stopUpdate.ConditionExpression).toBe('#st = :running');
    // No release, no nextReleaseAt advance
    expect(updateCalls('batch-runs').some((u) => u.UpdateExpression.includes('nextReleaseAt'))).toBe(false);
  });
});

describe('dispatchDueBatchRuns — unfinished-instance cap', () => {
  function launchedRow(rowNumber: number, instanceId: string): BatchRow {
    return {
      ...makeQueuedRow(rowNumber, rowNumber, { Name: `N${rowNumber}`, Email: `${rowNumber}@x.com` }),
      status: 'launched',
      workflowInstanceId: instanceId,
    };
  }

  it('releases only up to the shared budget (cap minus unfinished instances)', async () => {
    installMockDb({
      run: makeRun({ settings: { releaseCount: 5, intervalMinutes: 10, stopAfterFailures: 5 } }),
      queuedRows: [10, 11, 12, 13].map((n) => makeQueuedRow(n, n, { Name: `N${n}`, Email: `${n}@x.com` })),
      allRows: [launchedRow(1, 'i-1'), launchedRow(2, 'i-2'), launchedRow(3, 'i-3')],
      instances: {
        'i-1': { id: 'i-1', status: 'running', startedAt: new Date().toISOString() },
        'i-2': { id: 'i-2', status: 'running', startedAt: new Date().toISOString() },
        'i-3': { id: 'i-3', status: 'running', startedAt: new Date().toISOString() },
      },
      processorOverrides: { maxUnfinishedInstances: 5 },
    });

    await dispatchDueBatchRuns();

    // 3 unfinished, cap 5 → budget 2, even though the run's throttle allows 5
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });

  it('overdue instances free their slots (the release valve)', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
    installMockDb({
      run: makeRun({ settings: { releaseCount: 5, intervalMinutes: 10, stopAfterFailures: 5 } }),
      queuedRows: [10, 11, 12, 13].map((n) => makeQueuedRow(n, n, { Name: `N${n}`, Email: `${n}@x.com` })),
      allRows: [launchedRow(1, 'i-1'), launchedRow(2, 'i-2'), launchedRow(3, 'i-3')],
      instances: {
        // Two instances past their 1-day threshold: Overdue, slots freed
        'i-1': { id: 'i-1', status: 'running', startedAt: threeDaysAgo, expectedDurationDays: 1 },
        'i-2': { id: 'i-2', status: 'running', startedAt: threeDaysAgo, expectedDurationDays: 1 },
        'i-3': { id: 'i-3', status: 'running', startedAt: new Date().toISOString() },
      },
      processorOverrides: { maxUnfinishedInstances: 5 },
    });

    await dispatchDueBatchRuns();

    // Only 1 counts as unfinished → budget 4 → all 4 queued rows released
    expect(mockSendMessage).toHaveBeenCalledTimes(4);
  });

  it('a postponed overdue instance counts again (admin chose to keep waiting)', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    installMockDb({
      run: makeRun({ settings: { releaseCount: 5, intervalMinutes: 10, stopAfterFailures: 5 } }),
      queuedRows: [10, 11].map((n) => makeQueuedRow(n, n, { Name: `N${n}`, Email: `${n}@x.com` })),
      allRows: [launchedRow(1, 'i-1')],
      instances: {
        'i-1': { id: 'i-1', status: 'running', startedAt: threeDaysAgo, expectedDurationDays: 1, overdueSnoozedUntil: tomorrow },
      },
      processorOverrides: { maxUnfinishedInstances: 1 },
    });

    await dispatchDueBatchRuns();

    // The snoozed instance occupies the only slot → nothing released
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('dispatchDueBatchRuns — legacy queued runs', () => {
  it('promotes a pre-concurrency queued run straight to running', async () => {
    installMockDb({
      run: makeRun({ status: 'queued' }),
      queuedRows: [],
      allRows: [],
      instances: {},
    });

    await dispatchDueBatchRuns();

    const promote = updateCalls('batch-runs').find(
      (u) => u.ExpressionAttributeValues?.[':next'] === 'running' && u.ConditionExpression === '#st = :queued',
    );
    expect(promote).toBeDefined();
    expect(promote.UpdateExpression).toContain('nextReleaseAt');
    expect(promote.ExpressionAttributeValues[':zero']).toBe(0);
  });

  it('promotes to paused instead when the processor has a paused sibling (operator hold)', async () => {
    installMockDb({
      run: makeRun({ status: 'queued' }),
      queuedRows: [],
      allRows: [],
      instances: {},
      siblingRuns: [makeRun({ id: 'run-0', runNumber: 0, status: 'paused' })],
    });

    await dispatchDueBatchRuns();

    const promote = updateCalls('batch-runs').find((u) => u.ConditionExpression === '#st = :queued');
    expect(promote).toBeDefined();
    expect(promote.ExpressionAttributeValues[':next']).toBe('paused');
    // A held run must not get a release clock - resume sets it explicitly.
    expect(promote.UpdateExpression).not.toContain('nextReleaseAt');
  });
});

describe('dispatchDueBatchRuns — completion', () => {
  it('marks the run completed when no queued/launching rows remain and launched rows are terminal', async () => {
    const launchedRow: BatchRow = {
      ...makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' }),
      status: 'launched',
      workflowInstanceId: 'inst-1',
    };
    installMockDb({
      run: makeRun(),
      queuedRows: [],
      allRows: [launchedRow, { ...makeQueuedRow(2, 2, { Name: 'Bob', Email: 'b@x.com' }), status: 'skipped' }],
      instances: { 'inst-1': { id: 'inst-1', status: 'completed', completedAt: '2026-08-05T10:00:00.000Z' } },
    });

    await dispatchDueBatchRuns();

    // Terminal instance state lazily persisted to the row
    const rowPersist = updateCalls('batch-rows').find(
      (u) => u.ExpressionAttributeValues?.[':v_status'] === 'completed',
    );
    expect(rowPersist).toBeDefined();

    // Run flipped to completed (conditionally, only while still running)
    const completeUpdate = updateCalls('batch-runs').find(
      (u) => u.ExpressionAttributeValues?.[':completed'] === 'completed',
    );
    expect(completeUpdate).toBeDefined();
    expect(completeUpdate.ConditionExpression).toBe('#st = :running');
  });

  it('fails a stale launching row so the run can eventually close (sweep)', async () => {
    const staleRow: BatchRow = {
      ...makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' }),
      status: 'launching',
      launchingAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), // 2h ago
    };
    installMockDb({
      run: makeRun({ nextReleaseAt: new Date(Date.now() + 60_000).toISOString() }), // not due
      queuedRows: [],
      allRows: [staleRow],
      instances: {},
    });

    await dispatchDueBatchRuns();

    const sweepUpdate = updateCalls('batch-rows').find(
      (u) => u.ExpressionAttributeValues?.[':failed'] === 'failed',
    );
    expect(sweepUpdate).toBeDefined();
    expect(sweepUpdate.Key).toEqual({ runId: 'run-1', rowNumber: 1 });
    expect(sweepUpdate.ConditionExpression).toContain('launchingAt <= :cutoff');

    // Swept failures feed the stop-after-failures breaker
    const streakAdd = updateCalls('batch-runs').find(
      (u) => u.UpdateExpression === 'ADD consecutiveFailures :n',
    );
    expect(streakAdd).toBeDefined();
    expect(streakAdd.ExpressionAttributeValues[':n']).toBe(1);
  });

  it('cancels the stranded retry-tracking instance when sweeping its row (sweep)', async () => {
    const staleRowWithTracker: BatchRow = {
      ...makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' }),
      status: 'launching',
      launchingAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      workflowInstanceId: 'inst-tracker',
    };
    installMockDb({
      run: makeRun({ nextReleaseAt: new Date(Date.now() + 60_000).toISOString() }),
      queuedRows: [],
      allRows: [staleRowWithTracker],
      instances: {},
    });

    await dispatchDueBatchRuns();

    const trackerCancel = updateCalls('instances').find(
      (u) => u.ExpressionAttributeValues?.[':cancelled'] === 'cancelled',
    );
    expect(trackerCancel).toBeDefined();
    expect(trackerCancel.Key).toEqual({ id: 'inst-tracker' });
    // Never touches an instance that actually launched
    expect(trackerCancel.ConditionExpression).toContain('attribute_not_exists(maestroInstanceId)');
  });

  it('adopts a pre-timestamp launching row instead of failing it (sweep)', async () => {
    const untimedRow: BatchRow = {
      ...makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' }),
      status: 'launching',
    };
    installMockDb({
      run: makeRun({ nextReleaseAt: new Date(Date.now() + 60_000).toISOString() }),
      queuedRows: [],
      allRows: [untimedRow],
      instances: {},
    });

    await dispatchDueBatchRuns();

    const adopt = updateCalls('batch-rows').find(
      (u) => u.ConditionExpression === '#st = :launching AND attribute_not_exists(launchingAt)',
    );
    expect(adopt).toBeDefined();
    expect(updateCalls('batch-rows').some((u) => u.ExpressionAttributeValues?.[':failed'] === 'failed')).toBe(false);
  });

  it('leaves a fresh launching row alone (sweep)', async () => {
    const freshRow: BatchRow = {
      ...makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' }),
      status: 'launching',
      launchingAt: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago
    };
    installMockDb({
      run: makeRun({ nextReleaseAt: new Date(Date.now() + 60_000).toISOString() }),
      queuedRows: [],
      allRows: [freshRow],
      instances: {},
    });

    await dispatchDueBatchRuns();

    expect(updateCalls('batch-rows').some((u) => u.ExpressionAttributeValues?.[':failed'] === 'failed')).toBe(false);
    expect(updateCalls('batch-rows').some(
      (u) => u.ConditionExpression === '#st = :launching AND attribute_not_exists(launchingAt)',
    )).toBe(false);
  });

  it('sweeps stale launching rows of stopped runs too', async () => {
    const staleRow: BatchRow = {
      ...makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' }),
      status: 'launching',
      launchingAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    };
    installMockDb({
      run: makeRun({ status: 'stopped' }),
      queuedRows: [],
      allRows: [staleRow],
      instances: {},
    });

    await dispatchDueBatchRuns();

    expect(updateCalls('batch-rows').some((u) => u.ExpressionAttributeValues?.[':failed'] === 'failed')).toBe(true);
  });

  it('does NOT complete the run while a launched row is still running', async () => {
    const launchedRow: BatchRow = {
      ...makeQueuedRow(1, 1, { Name: 'Alice', Email: 'a@x.com' }),
      status: 'launched',
      workflowInstanceId: 'inst-1',
    };
    installMockDb({
      run: makeRun(),
      queuedRows: [],
      allRows: [launchedRow],
      instances: { 'inst-1': { id: 'inst-1', status: 'running' } },
    });

    await dispatchDueBatchRuns();

    expect(updateCalls('batch-runs').some((u) => u.ExpressionAttributeValues?.[':completed'] === 'completed')).toBe(false);
  });
});
