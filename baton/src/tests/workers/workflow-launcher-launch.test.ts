/**
 * Tests for processWorkflowLaunchJob — first attempt & retry fixes:
 * 1. workflowInstanceId on pipeline entry uses resolvedInstanceId (not pipelineEntryId)
 * 2. instanceUrl is stored on the instance at creation
 * 3. Retry reuses existing instance ID, doesn't create a new one
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────

const INSTANCE_UUID = 'new-instance-uuid-fixed';

vi.mock('uuid', () => ({ v4: vi.fn(() => INSTANCE_UUID) }));

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: {
    WORKFLOWS: 'baton-workflows',
    WORKFLOW_INSTANCES: 'baton-workflow-instances',
    TRIGGER_PIPELINE: 'baton-trigger-pipeline',
    AUTOMATION_RULES: 'baton-automation-rules',
  },
}));

const mockLaunchWorkflow = vi.fn();
vi.mock('../../services/maestro.service', () => ({
  launchWorkflow: (...args: any[]) => mockLaunchWorkflow(...args),
}));

vi.mock('../../services/connection.service', () => ({
  getConnection: vi.fn().mockResolvedValue({ id: 'conn-1' }),
  getConnectionByOrgAndPlatform: vi.fn(),
}));

const mockIncrementCount = vi.fn();
vi.mock('../../services/usage.service', () => ({
  incrementExecutionCount: (...args: any[]) => mockIncrementCount(...args),
}));

vi.mock('../../services/notification.service', () => ({
  sendNotification: vi.fn(),
  workflowFailedNotification: vi.fn(() => ({})),
  rulePausedNotification: vi.fn(() => ({})),
  retryExhaustedNotification: vi.fn(() => ({})),
}));

vi.mock('../../queue/sqs-client', () => ({
  sendMessage: vi.fn(),
  QueueNames: { WORKFLOW_LAUNCHER: 'workflow-launcher' },
}));

vi.mock('../../services/user.service', () => ({
  getOrgAdmin: vi.fn().mockResolvedValue('admin-user-1'),
  getOrgAdmins: vi.fn().mockResolvedValue(['admin-user-1']),
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { processWorkflowLaunchJob } from '../../workers/workflow-launcher.worker';

// ─── Fixtures ────────────────────────────────────────────────

const MAESTRO_INSTANCE_ID = 'maestro-inst-xyz';
const MAESTRO_INSTANCE_URL = 'https://apps.docusign.com/maestro/instances/maestro-inst-xyz';

const fakeWorkflow = {
  id: 'workflow-1',
  name: 'Test Workflow',
  maestroWorkflowId: 'maestro-wf-1',
  connectionId: 'conn-1',
  orgId: 'org-1',
  launchCount: 5,
};

const fakeRule = {
  id: 'rule-1',
  timesTriggered: 5,
  failureCount: 1,
};

const baseJob = {
  ruleId: 'rule-1',
  pipelineEntryId: 'pipeline-entry-1',
  workflowId: 'workflow-1',
  orgId: 'org-1',
  inputData: { key: 'value' },
  instanceName: 'Test Instance',
  requestId: 'req-1',
};

// ─── Helpers ─────────────────────────────────────────────────

/** Sets up DynamoDB mock responses for a successful first-attempt launch */
function setupFirstAttemptMocks() {
  mockSend
    .mockResolvedValueOnce({ Item: fakeWorkflow })   // GetCommand: workflow
    .mockResolvedValueOnce({})                        // PutCommand: instance
    .mockResolvedValueOnce({})                        // UpdateCommand: pipeline entry success
    .mockResolvedValueOnce({})                        // UpdateCommand: workflow stats
    .mockResolvedValueOnce({ Item: fakeRule })        // GetCommand: rule (updateRuleSuccess)
    .mockResolvedValueOnce({});                       // UpdateCommand: rule (updateRuleSuccess)
}

/** Finds all PutCommands targeting the workflow-instances table */
function findInstancePuts() {
  return mockSend.mock.calls.filter(
    ([cmd]) => cmd.input?.Item !== undefined && cmd.input.TableName?.includes('workflow-instances'),
  );
}

/** Finds the UpdateCommand targeting the trigger-pipeline table */
function findPipelineUpdate() {
  return mockSend.mock.calls.find(
    ([cmd]) => cmd.input?.UpdateExpression !== undefined &&
               cmd.input.TableName?.includes('trigger-pipeline') &&
               cmd.input.Key?.id === baseJob.pipelineEntryId,
  );
}

// ─── beforeEach ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockReset(); // also drops queued mockResolvedValueOnce values
  mockLaunchWorkflow.mockResolvedValue({
    instanceId: MAESTRO_INSTANCE_ID,
    instanceUrl: MAESTRO_INSTANCE_URL,
  });
  mockIncrementCount.mockResolvedValue(undefined);
});

// ─── First attempt ───────────────────────────────────────────

describe('processWorkflowLaunchJob — first attempt', () => {
  it('creates instance with a new UUID, not pipelineEntryId', async () => {
    setupFirstAttemptMocks();
    await processWorkflowLaunchJob(baseJob);

    const puts = findInstancePuts();
    expect(puts).toHaveLength(1);
    expect(puts[0][0].input.Item.id).toBe(INSTANCE_UUID);
    expect(puts[0][0].input.Item.id).not.toBe(baseJob.pipelineEntryId);
  });

  it('stores instanceUrl on the created instance', async () => {
    setupFirstAttemptMocks();
    await processWorkflowLaunchJob(baseJob);

    const puts = findInstancePuts();
    expect(puts[0][0].input.Item.instanceUrl).toBe(MAESTRO_INSTANCE_URL);
  });

  it('stores maestroInstanceId on the created instance', async () => {
    setupFirstAttemptMocks();
    await processWorkflowLaunchJob(baseJob);

    const puts = findInstancePuts();
    expect(puts[0][0].input.Item.maestroInstanceId).toBe(MAESTRO_INSTANCE_ID);
  });

  it('sets pipeline entry workflowInstanceId to the new instance UUID', async () => {
    setupFirstAttemptMocks();
    await processWorkflowLaunchJob(baseJob);

    const update = findPipelineUpdate();
    expect(update).toBeDefined();
    const instanceId = update![0].input.ExpressionAttributeValues[':instanceId'];
    expect(instanceId).toBe(INSTANCE_UUID);
    expect(instanceId).not.toBe(baseJob.pipelineEntryId);
  });

  it('marks pipeline entry as completed', async () => {
    setupFirstAttemptMocks();
    await processWorkflowLaunchJob(baseJob);

    const update = findPipelineUpdate();
    expect(update![0].input.ExpressionAttributeValues[':status']).toBe('completed');
  });
});

// ─── Retry attempt ───────────────────────────────────────────

describe('processWorkflowLaunchJob — retry attempt', () => {
  const EXISTING_INSTANCE_ID = 'existing-instance-abc';
  const retryJob = {
    ...baseJob,
    retry: {
      attempt: 1,
      maxAttempts: 6,
      sequenceId: 'seq-abc',
      instanceId: EXISTING_INSTANCE_ID,
    },
  };

  function setupRetryMocks() {
    mockSend
      .mockResolvedValueOnce({ Item: { id: EXISTING_INSTANCE_ID, status: 'running', retrySequenceId: 'seq-abc' } })  // GetCommand: existing instance guard
      .mockResolvedValueOnce({ Item: fakeWorkflow })  // GetCommand: workflow
      .mockResolvedValueOnce({})                      // UpdateCommand: instance (update, not create)
      .mockResolvedValueOnce({})                      // UpdateCommand: pipeline entry
      .mockResolvedValueOnce({ Item: fakeRule })      // GetCommand: rule (updateRuleSuccess)
      .mockResolvedValueOnce({});                     // UpdateCommand: rule (updateRuleSuccess)
  }

  it('does not create a new instance record — reuses existing', async () => {
    setupRetryMocks();
    await processWorkflowLaunchJob(retryJob);

    const puts = findInstancePuts();
    expect(puts).toHaveLength(0);
  });

  it('sets pipeline entry workflowInstanceId to retry.instanceId', async () => {
    setupRetryMocks();
    await processWorkflowLaunchJob(retryJob);

    const update = findPipelineUpdate();
    expect(update).toBeDefined();
    expect(update![0].input.ExpressionAttributeValues[':instanceId']).toBe(EXISTING_INSTANCE_ID);
  });

  it('abandons retry when instance is already resolved (completed)', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { id: EXISTING_INSTANCE_ID, status: 'completed' },
    });
    await processWorkflowLaunchJob(retryJob);

    // Maestro should not be called if instance already resolved
    expect(mockLaunchWorkflow).not.toHaveBeenCalled();
  });

  it('abandons retry when sequenceId is superseded', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { id: EXISTING_INSTANCE_ID, status: 'running', retrySequenceId: 'different-seq' },
    });
    await processWorkflowLaunchJob(retryJob);

    expect(mockLaunchWorkflow).not.toHaveBeenCalled();
  });
});
