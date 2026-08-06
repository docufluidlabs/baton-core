/**
 * Workflow launcher — Bulk Upload (batch) path tests
 * Verifies: no TRIGGER_PIPELINE writes on the batch path, row updated to
 * 'launched' + run failure streak reset on success, row 'failed' + streak
 * increment on final failure, relay-gate denial marks the row 'skipped',
 * retry ladder preserved with batch metadata, metering unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: mockSend }),
  TableNames: {
    WORKFLOWS: 'workflows',
    WORKFLOW_INSTANCES: 'instances',
    TRIGGER_PIPELINE: 'pipeline',
    AUTOMATION_RULES: 'rules',
    ORGANIZATIONS: 'organizations',
    USERS: 'users',
    BATCH_RUNS: 'batch-runs',
    BATCH_ROWS: 'batch-rows',
  },
}));

const { mockLaunchWorkflow } = vi.hoisted(() => ({ mockLaunchWorkflow: vi.fn() }));
vi.mock('../../services/maestro.service', () => ({
  launchWorkflow: mockLaunchWorkflow,
}));

const { mockGetConnection, mockGetConnectionByOrgAndPlatform } = vi.hoisted(() => ({
  mockGetConnection: vi.fn(),
  mockGetConnectionByOrgAndPlatform: vi.fn(),
}));
vi.mock('../../services/connection.service', () => ({
  getConnection: mockGetConnection,
  getConnectionByOrgAndPlatform: mockGetConnectionByOrgAndPlatform,
}));

const { mockSendNotification } = vi.hoisted(() => ({ mockSendNotification: vi.fn() }));
vi.mock('../../services/notification.service', () => ({
  sendNotification: mockSendNotification,
  workflowFailedNotification: vi.fn((...args: any[]) => ({ type: 'wf_failed', args })),
  rulePausedNotification: vi.fn((...args: any[]) => ({ type: 'rule_paused', args })),
  retryExhaustedNotification: vi.fn((...args: any[]) => ({ type: 'retry_exhausted', args })),
}));

const { mockIncrementExecution } = vi.hoisted(() => ({ mockIncrementExecution: vi.fn() }));
vi.mock('../../services/usage.service', () => ({
  incrementExecutionCount: mockIncrementExecution,
}));

const mockMeterRecord = vi.fn();

vi.mock('../../services/user.service', () => ({
  getOrgAdmin: vi.fn().mockResolvedValue('admin-1'),
  getOrgAdmins: vi.fn().mockResolvedValue(['admin-1']),
}));

const { mockSendMessage } = vi.hoisted(() => ({ mockSendMessage: vi.fn() }));
vi.mock('../../queue/sqs-client', () => ({
  sendMessage: mockSendMessage,
  QueueNames: { WORKFLOW_LAUNCHER: 'workflow-launcher' },
}));

import { processWorkflowLaunchJob } from '../../workers/workflow-launcher.worker';
import { setRelayGate, setRelayMeter } from '../../lib/billing-hooks';
import { WorkflowLaunchJob } from '../../lib/types';

// ─── Fixtures + helpers ─────────────────────────────────────

const batchJob: WorkflowLaunchJob = {
  workflowId: 'wf-1',
  orgId: 'org-1',
  inputData: { customerName: 'Alice', customerEmail: 'a@x.com' },
  instanceName: '1 · Alice · row 1',
  sourcePlatform: 'salesforce',
  batch: { runId: 'run-1', rowNumber: 1 },
};

const workflow = { id: 'wf-1', maestroWorkflowId: 'maestro-wf-1', connectionId: 'conn-ds-1' };

function installDefaultDb() {
  mockSend.mockImplementation(async (cmd: any) => {
    const name = cmd.constructor.name;
    const input = cmd.input;
    if (name === 'GetCommand' && input.TableName === 'workflows') return { Item: workflow };
    return {};
  });
}

function callsFor(table: string, commandName?: string): any[] {
  return mockSend.mock.calls
    .map(([cmd]) => cmd)
    .filter((cmd) =>
      cmd.input?.TableName === table &&
      (!commandName || cmd.constructor.name === commandName))
    .map((cmd) => cmd.input);
}

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultDb();
  mockGetConnection.mockResolvedValue({ id: 'conn-ds-1', platform: 'docusign' });
  // Reset the billing-hooks seam to its default allow-all gate + mock meter.
  setRelayGate({ check: async () => ({ allowed: true }) });
  mockMeterRecord.mockResolvedValue(undefined);
  setRelayMeter({ record: mockMeterRecord });
  mockIncrementExecution.mockResolvedValue(undefined);
  mockSendMessage.mockResolvedValue('msg-1');
  mockSendNotification.mockResolvedValue(undefined);
});

// ─── Success path ───────────────────────────────────────────

describe('processWorkflowLaunchJob — batch success', () => {
  beforeEach(() => {
    mockLaunchWorkflow.mockResolvedValueOnce({
      instanceId: 'maestro-inst-1',
      instanceUrl: 'https://example.com/inst-1',
    });
  });

  it('creates the instance with launchedBy batch + batch fields', async () => {
    await processWorkflowLaunchJob(batchJob);

    const puts = callsFor('instances', 'PutCommand');
    expect(puts).toHaveLength(1);
    expect(puts[0].Item).toMatchObject({
      launchedBy: 'batch',
      batchRunId: 'run-1',
      batchRowNumber: 1,
      status: 'running',
      maestroInstanceId: 'maestro-inst-1',
    });
  });

  it('updates the row to launched with instance ids and resets the run failure streak', async () => {
    await processWorkflowLaunchJob(batchJob);

    const rowUpdates = callsFor('batch-rows', 'UpdateCommand');
    expect(rowUpdates).toHaveLength(1);
    expect(rowUpdates[0].Key).toEqual({ runId: 'run-1', rowNumber: 1 });
    expect(rowUpdates[0].ExpressionAttributeValues[':status']).toBe('launched');
    expect(rowUpdates[0].ExpressionAttributeValues[':mid']).toBe('maestro-inst-1');
    expect(typeof rowUpdates[0].ExpressionAttributeValues[':wid']).toBe('string');

    const runUpdates = callsFor('batch-runs', 'UpdateCommand');
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0].UpdateExpression).toContain('consecutiveFailures');
    expect(runUpdates[0].ExpressionAttributeValues[':zero']).toBe(0);
  });

  it('writes NOTHING to the trigger pipeline', async () => {
    await processWorkflowLaunchJob(batchJob);
    expect(callsFor('pipeline')).toHaveLength(0);
  });

  it('keeps metering unchanged (execution count + relay meter seam)', async () => {
    await processWorkflowLaunchJob(batchJob);

    expect(mockIncrementExecution).toHaveBeenCalledWith('org-1');
    expect(mockMeterRecord).toHaveBeenCalledWith('org-1', 1, expect.any(String));
  });

  it('does not touch automation rule stats without a ruleId', async () => {
    await processWorkflowLaunchJob(batchJob);
    expect(callsFor('rules')).toHaveLength(0);
  });
});

// ─── Relay gate ─────────────────────────────────────────────

describe('processWorkflowLaunchJob — batch relay gate', () => {
  it('marks the row skipped (with message) and does not launch when the gate denies', async () => {
    setRelayGate({ check: async () => ({ allowed: false, reason: 'hard_cap_reached' }) });

    await processWorkflowLaunchJob(batchJob);

    expect(mockLaunchWorkflow).not.toHaveBeenCalled();
    const rowUpdates = callsFor('batch-rows', 'UpdateCommand');
    expect(rowUpdates).toHaveLength(1);
    expect(rowUpdates[0].ExpressionAttributeValues[':status']).toBe('skipped');
    expect(rowUpdates[0].ExpressionAttributeValues[':err']).toContain('usage limit');
    expect(callsFor('pipeline')).toHaveLength(0);
  });
});

// ─── Failure path ───────────────────────────────────────────

describe('processWorkflowLaunchJob — batch failure', () => {
  it('marks the row failed and increments the run failure streak on a non-retryable error (no throw)', async () => {
    mockLaunchWorkflow.mockRejectedValueOnce(new Error('401 Unauthorized'));

    // Batch jobs must NOT re-throw — the row already carries the failure.
    await expect(processWorkflowLaunchJob(batchJob)).resolves.toBeUndefined();

    const rowUpdates = callsFor('batch-rows', 'UpdateCommand');
    expect(rowUpdates).toHaveLength(1);
    expect(rowUpdates[0].ExpressionAttributeValues[':status']).toBe('failed');
    expect(rowUpdates[0].ExpressionAttributeValues[':err']).toContain('401');
    expect(rowUpdates[0].ConditionExpression).toBe('#st <> :status');

    const runUpdates = callsFor('batch-runs', 'UpdateCommand');
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0].UpdateExpression).toContain('ADD consecutiveFailures');

    // No pipeline writes, no rule stats, no failure notification fanout
    expect(callsFor('pipeline')).toHaveLength(0);
    expect(callsFor('rules')).toHaveLength(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('keeps the retry ladder: enqueues a retry with batch metadata on a retryable error', async () => {
    mockLaunchWorkflow.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    await processWorkflowLaunchJob(batchJob);

    // Retry-tracking instance carries the batch fields
    const puts = callsFor('instances', 'PutCommand');
    expect(puts).toHaveLength(1);
    expect(puts[0].Item).toMatchObject({ launchedBy: 'batch', batchRunId: 'run-1', batchRowNumber: 1 });

    // Retry job preserves the batch metadata
    expect(mockSendMessage).toHaveBeenCalledWith(
      'workflow-launcher',
      expect.objectContaining({
        batch: { runId: 'run-1', rowNumber: 1 },
        retry: expect.objectContaining({ attempt: 1, maxAttempts: 6 }),
      }),
      expect.objectContaining({ delaySeconds: 2 }),
    );

    // The row is still mid-flight — not failed yet
    expect(callsFor('batch-rows', 'UpdateCommand')).toHaveLength(0);
    expect(callsFor('pipeline')).toHaveLength(0);
  });

  it('marks the row failed once retries are exhausted and links the tracking instance', async () => {
    // Retry guard lookup: instance still running with the matching sequence
    mockSend.mockImplementation(async (cmd: any) => {
      const name = cmd.constructor.name;
      const input = cmd.input;
      if (name === 'GetCommand' && input.TableName === 'instances') {
        return { Item: { id: 'inst-1', status: 'running', retrySequenceId: 'seq-1' } };
      }
      if (name === 'GetCommand' && input.TableName === 'workflows') return { Item: workflow };
      return {};
    });
    mockLaunchWorkflow.mockRejectedValueOnce(new Error('timeout'));

    await processWorkflowLaunchJob({
      ...batchJob,
      retry: { attempt: 6, maxAttempts: 6, sequenceId: 'seq-1', instanceId: 'inst-1' },
    });

    // No further retry
    expect(mockSendMessage).not.toHaveBeenCalled();

    const rowUpdates = callsFor('batch-rows', 'UpdateCommand');
    expect(rowUpdates).toHaveLength(1);
    expect(rowUpdates[0].ExpressionAttributeValues[':status']).toBe('failed');
    expect(rowUpdates[0].ExpressionAttributeValues[':wid']).toBe('inst-1');

    // Failure streak incremented; no batch notifications
    const runUpdates = callsFor('batch-runs', 'UpdateCommand');
    expect(runUpdates.some((u) => u.UpdateExpression.includes('ADD consecutiveFailures'))).toBe(true);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
