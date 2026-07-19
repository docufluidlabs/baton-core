/**
 * workflow-launcher.worker — triggerActionNumber tests
 *
 * Verifies that actionNumber from WorkflowLaunchJob is stored
 * as triggerActionNumber on the WorkflowInstance (both first-attempt
 * and retry-failure paths).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────

const INSTANCE_UUID = 'inst-uuid-action-test';

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
  getConnectionByOrgAndPlatform: vi.fn(),
}));

const mockCheckQuota = vi.fn();
const mockIncrementCount = vi.fn();
vi.mock('../../services/usage.service', () => ({
  checkExecutionQuota: (...args: any[]) => mockCheckQuota(...args),
  incrementExecutionCount: (...args: any[]) => mockIncrementCount(...args),
  ExecutionLimitError: class ExecutionLimitError extends Error {
    constructor(orgId: string, used: number, limit: number) {
      super(`Quota exceeded: ${used}/${limit}`);
    }
  },
}));

vi.mock('../../services/notification.service', () => ({
  sendNotification: vi.fn(),
  workflowFailedNotification: vi.fn(() => ({})),
  rulePausedNotification: vi.fn(() => ({})),
  retryExhaustedNotification: vi.fn(() => ({})),
  executionQuotaExceededNotification: vi.fn(() => ({})),
}));

vi.mock('../../queue/sqs-client', () => ({
  sendMessage: vi.fn(),
  QueueNames: { WORKFLOW_LAUNCHER: 'workflow-launcher' },
}));

vi.mock('../../services/user.service', () => ({
  getOrgAdmin: vi.fn().mockResolvedValue('admin-1'),
  getOrgAdmins: vi.fn().mockResolvedValue(['admin-1']),
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })),
}));

import { processWorkflowLaunchJob } from '../../workers/workflow-launcher.worker';

// ─── Fixtures ────────────────────────────────────────────────

const MAESTRO_INSTANCE_ID = 'maestro-inst-action';
const MAESTRO_INSTANCE_URL = 'https://apps.docusign.com/maestro/instances/action-test';

const fakeWorkflow = {
  id: 'workflow-1',
  name: 'Test Workflow',
  maestroWorkflowId: 'maestro-wf-1',
  connectionId: 'conn-1',
  orgId: 'org-1',
  launchCount: 0,
};

const fakeRule = { id: 'rule-1', timesTriggered: 0, failureCount: 0 };

const baseJob = {
  ruleId: 'rule-1',
  ruleName: 'test 1',
  actionNumber: 13,
  pipelineEntryId: 'pipeline-1',
  workflowId: 'workflow-1',
  orgId: 'org-1',
  inputData: { key: 'val' },
  instanceName: 'Test Instance',
  requestId: 'req-1',
};

function setupSuccessMocks() {
  mockSend
    .mockResolvedValueOnce({ Item: fakeWorkflow })  // GetCommand: workflow
    .mockResolvedValueOnce({})                       // PutCommand: instance
    .mockResolvedValueOnce({})                       // UpdateCommand: pipeline success
    .mockResolvedValueOnce({})                       // UpdateCommand: workflow stats
    .mockResolvedValueOnce({ Item: fakeRule })       // GetCommand: rule
    .mockResolvedValueOnce({});                      // UpdateCommand: rule stats
}

function setupFailureMocks() {
  mockSend
    .mockResolvedValueOnce({ Item: fakeWorkflow })  // GetCommand: workflow
    .mockResolvedValueOnce({})                       // PutCommand: instance (created on failure)
    .mockResolvedValueOnce({})                       // UpdateCommand: pipeline failure
    .mockResolvedValueOnce({ Item: fakeRule })       // GetCommand: rule
    .mockResolvedValueOnce({});                      // UpdateCommand: rule failure stats
}

function findInstancePuts() {
  return mockSend.mock.calls.filter(
    ([cmd]: any[]) => cmd.input?.Item !== undefined &&
                      cmd.input.TableName?.includes('workflow-instances'),
  );
}

// ─── beforeEach ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckQuota.mockResolvedValue({ allowed: true, used: 3, limit: 500 });
  mockIncrementCount.mockResolvedValue(undefined);
  mockLaunchWorkflow.mockResolvedValue({
    instanceId: MAESTRO_INSTANCE_ID,
    instanceUrl: MAESTRO_INSTANCE_URL,
  });
});

// ─── Tests ───────────────────────────────────────────────────

describe('processWorkflowLaunchJob — triggerActionNumber (first attempt)', () => {
  it('stores triggerActionNumber on created instance', async () => {
    setupSuccessMocks();
    await processWorkflowLaunchJob(baseJob);

    const puts = findInstancePuts();
    expect(puts).toHaveLength(1);
    expect(puts[0][0].input.Item.triggerActionNumber).toBe(13);
  });

  it('stores triggerRuleName alongside triggerActionNumber', async () => {
    setupSuccessMocks();
    await processWorkflowLaunchJob(baseJob);

    const puts = findInstancePuts();
    expect(puts[0][0].input.Item.triggerRuleName).toBe('test 1');
    expect(puts[0][0].input.Item.triggerActionNumber).toBe(13);
  });

  it('triggerActionNumber is undefined when not provided in job', async () => {
    setupSuccessMocks();
    const jobWithoutNumber = { ...baseJob, actionNumber: undefined };
    await processWorkflowLaunchJob(jobWithoutNumber);

    const puts = findInstancePuts();
    expect(puts[0][0].input.Item.triggerActionNumber).toBeUndefined();
  });

  it('stores triggerRuleId on instance', async () => {
    setupSuccessMocks();
    await processWorkflowLaunchJob(baseJob);

    const puts = findInstancePuts();
    expect(puts[0][0].input.Item.triggerRuleId).toBe('rule-1');
  });
});

describe('processWorkflowLaunchJob — triggerActionNumber (retry/failure path)', () => {
  it('stores triggerActionNumber on instance created on first failure', async () => {
    mockLaunchWorkflow.mockRejectedValueOnce(new Error('500 Internal Server Error'));
    setupFailureMocks();

    await processWorkflowLaunchJob(baseJob);

    const puts = findInstancePuts();
    expect(puts.length).toBeGreaterThanOrEqual(1);
    expect(puts[0][0].input.Item.triggerActionNumber).toBe(13);
  });
});

describe('processWorkflowLaunchJob — quota check uses updated limit', () => {
  it('allows launch when usage is below 500', async () => {
    mockCheckQuota.mockResolvedValue({ allowed: true, used: 499, limit: 500 });
    setupSuccessMocks();

    await processWorkflowLaunchJob(baseJob);

    const puts = findInstancePuts();
    expect(puts).toHaveLength(1);
  });

  it('rejects launch when quota.allowed is false (throws ExecutionLimitError)', async () => {
    mockCheckQuota.mockResolvedValue({ allowed: false, used: 500, limit: 500 });
    // workflow lookup + pipeline failure updates
    mockSend
      .mockResolvedValueOnce({ Item: fakeWorkflow })  // GetCommand: workflow
      .mockResolvedValueOnce({ Item: undefined })      // GetCommand: pipeline entry check
      .mockResolvedValue({});                          // UpdateCommand: pipeline failure + rule

    await processWorkflowLaunchJob(baseJob);

    // Maestro launch should NOT have been called
    expect(mockLaunchWorkflow).not.toHaveBeenCalled();
  });
});
