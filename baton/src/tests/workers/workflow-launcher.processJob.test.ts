/**
 * processWorkflowLaunchJob Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: mockSend }),
  TableNames: {
    WORKFLOWS: 'workflows',
    WORKFLOW_INSTANCES: 'instances',
    TRIGGER_PIPELINE: 'pipeline',
    AUTOMATION_RULES: 'rules',
    USERS: 'users',
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

const { mockIncrementExecution } = vi.hoisted(() => ({
  mockIncrementExecution: vi.fn(),
}));
vi.mock('../../services/usage.service', () => ({
  incrementExecutionCount: mockIncrementExecution,
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockReset(); // also drops queued mockResolvedValueOnce values
  mockGetConnection.mockResolvedValue({ id: 'conn-1' });
  mockIncrementExecution.mockResolvedValue(undefined);
  mockSendMessage.mockResolvedValue('msg-1');
  mockSendNotification.mockResolvedValue(undefined);
});

// ─── Helpers ──────────────────────────────────────────────────

const baseJob = {
  ruleId: 'rule-1',
  pipelineEntryId: 'pipe-1',
  workflowId: 'wf-1',
  orgId: 'org-1',
  inputData: { key: 'value' },
  instanceName: 'Test Instance',
};

function setupWorkflowLookup(workflow: Record<string, any> | undefined) {
  mockSend.mockResolvedValueOnce({ Item: workflow });
}

function setupSuccessfulLaunch() {
  setupWorkflowLookup({
    id: 'wf-1',
    maestroWorkflowId: 'maestro-wf-1',
    connectionId: 'conn-ds-1',
  });
  mockLaunchWorkflow.mockResolvedValueOnce({
    instanceId: 'maestro-inst-1',
    instanceUrl: 'https://example.com/inst-1',
  });
  // PutCommand for workflow_instance
  mockSend.mockResolvedValueOnce({});
  // UpdateCommand for pipeline entry
  mockSend.mockResolvedValueOnce({});
  // UpdateCommand for workflow stats
  mockSend.mockResolvedValueOnce({});
  // GetCommand for rule (updateRuleSuccess)
  mockSend.mockResolvedValueOnce({
    Item: { id: 'rule-1', timesTriggered: 10, failureCount: 0 },
  });
  // UpdateCommand for rule success rate
  mockSend.mockResolvedValueOnce({});
}

function setupRetryableFailure() {
  setupWorkflowLookup({
    id: 'wf-1',
    maestroWorkflowId: 'maestro-wf-1',
    connectionId: 'conn-1',
  });
  mockLaunchWorkflow.mockRejectedValueOnce(new Error('503 Service Unavailable'));
  // PutCommand for new instance (retry tracking)
  mockSend.mockResolvedValueOnce({});
  // UpdateCommand for pipeline entry (retrying status)
  mockSend.mockResolvedValueOnce({});
}

// ─── Happy Path ──────────────────────────────────────────────

describe('processWorkflowLaunchJob — success', () => {
  it('launches workflow and creates instance', async () => {
    setupSuccessfulLaunch();

    await processWorkflowLaunchJob(baseJob);

    expect(mockLaunchWorkflow).toHaveBeenCalledWith({
      connectionId: 'conn-ds-1',
      workflowId: 'maestro-wf-1',
      instanceName: 'Test Instance',
      triggerInputs: { key: 'value' },
    });

    // workflow lookup + instance put + pipeline update + workflow stats + rule lookup + rule update
    expect(mockSend).toHaveBeenCalledTimes(6);
  });

  it('uses connectionByOrgAndPlatform when workflow has no connectionId', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { id: 'wf-1', maestroWorkflowId: 'maestro-wf-1' },
    });
    mockGetConnectionByOrgAndPlatform.mockResolvedValueOnce({ id: 'conn-found' });
    mockLaunchWorkflow.mockResolvedValueOnce({
      instanceId: 'inst-2',
      instanceUrl: 'https://example.com/inst-2',
    });
    mockSend.mockResolvedValueOnce({}); // instance put
    mockSend.mockResolvedValueOnce({}); // pipeline update
    mockSend.mockResolvedValueOnce({}); // workflow stats
    mockSend.mockResolvedValueOnce({ Item: { id: 'rule-1', timesTriggered: 5, failureCount: 0 } });
    mockSend.mockResolvedValueOnce({}); // rule stats

    await processWorkflowLaunchJob(baseJob);

    expect(mockGetConnectionByOrgAndPlatform).toHaveBeenCalledWith('org-1', 'docusign');
    expect(mockLaunchWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-found' }),
    );
  });
});

// ─── Retry Logic ────────────────────────────────────────────

describe('processWorkflowLaunchJob — retry logic', () => {
  it('enqueues retry on retryable error (first attempt)', async () => {
    setupRetryableFailure();

    await processWorkflowLaunchJob(baseJob);

    // Should enqueue a retry message with 2s delay
    expect(mockSendMessage).toHaveBeenCalledWith(
      'workflow-launcher',
      expect.objectContaining({
        retry: expect.objectContaining({
          attempt: 1,
          maxAttempts: 6,
        }),
      }),
      expect.objectContaining({ delaySeconds: 2 }),
    );

    // Should NOT send failure notification (retrying)
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('enqueues retry with increasing delay', async () => {
    // Instance guard lookup (running + matching sequence)
    mockSend.mockResolvedValueOnce({
      Item: { id: 'inst-1', status: 'running', retrySequenceId: 'seq-1' },
    });
    setupWorkflowLookup({
      id: 'wf-1',
      maestroWorkflowId: 'maestro-wf-1',
      connectionId: 'conn-1',
    });
    mockLaunchWorkflow.mockRejectedValueOnce(new Error('timeout'));
    // UpdateCommand for existing instance
    mockSend.mockResolvedValueOnce({});
    // UpdateCommand for pipeline
    mockSend.mockResolvedValueOnce({});

    const jobWithRetry = {
      ...baseJob,
      retry: {
        attempt: 3,
        maxAttempts: 6,
        sequenceId: 'seq-1',
        instanceId: 'inst-1',
      },
    };

    await processWorkflowLaunchJob(jobWithRetry);

    // Attempt 4 delay = 300s (5min)
    expect(mockSendMessage).toHaveBeenCalledWith(
      'workflow-launcher',
      expect.objectContaining({
        retry: expect.objectContaining({ attempt: 4 }),
      }),
      expect.objectContaining({ delaySeconds: 300 }),
    );
  });

  it('uses deferUntil for delays exceeding SQS max (900s)', async () => {
    // Instance guard
    mockSend.mockResolvedValueOnce({
      Item: { id: 'inst-1', status: 'running', retrySequenceId: 'seq-1' },
    });
    setupWorkflowLookup({
      id: 'wf-1',
      maestroWorkflowId: 'maestro-wf-1',
      connectionId: 'conn-1',
    });
    mockLaunchWorkflow.mockRejectedValueOnce(new Error('timeout'));
    mockSend.mockResolvedValueOnce({}); // instance update
    mockSend.mockResolvedValueOnce({}); // pipeline update

    const jobWithRetry = {
      ...baseJob,
      retry: {
        attempt: 5,
        maxAttempts: 6,
        sequenceId: 'seq-1',
        instanceId: 'inst-1',
      },
    };

    await processWorkflowLaunchJob(jobWithRetry);

    // Attempt 6 delay = 1800s (> 900s SQS max)
    expect(mockSendMessage).toHaveBeenCalledWith(
      'workflow-launcher',
      expect.objectContaining({
        retry: expect.objectContaining({
          attempt: 6,
          deferUntil: expect.any(String),
        }),
      }),
      expect.objectContaining({ delaySeconds: 900 }),
    );
  });

  it('sends retryExhaustedNotification when all retries fail', async () => {
    // Instance guard
    mockSend.mockResolvedValueOnce({
      Item: { id: 'inst-1', status: 'running', retrySequenceId: 'seq-1' },
    });
    setupWorkflowLookup({
      id: 'wf-1',
      maestroWorkflowId: 'maestro-wf-1',
      connectionId: 'conn-1',
    });
    mockLaunchWorkflow.mockRejectedValueOnce(new Error('timeout'));

    // Instance update (mark failed)
    mockSend.mockResolvedValueOnce({});
    // Pipeline retry check
    mockSend.mockResolvedValueOnce({ Item: { status: 'retrying' } });
    // Pipeline failure update
    mockSend.mockResolvedValueOnce({});
    // Rule failure
    mockSend.mockResolvedValueOnce({ Item: { id: 'rule-1', orgId: 'org-1', timesTriggered: 10, failureCount: 2 } });
    mockSend.mockResolvedValueOnce({});
    // Workflow name + pipeline entry lookups for notification
    mockSend.mockResolvedValueOnce({ Item: { name: 'My Workflow' } });
    mockSend.mockResolvedValueOnce({});

    const jobWithRetry = {
      ...baseJob,
      retry: {
        attempt: 6, // last attempt
        maxAttempts: 6,
        sequenceId: 'seq-1',
        instanceId: 'inst-1',
      },
    };

    await processWorkflowLaunchJob(jobWithRetry);

    // Should NOT enqueue another retry
    expect(mockSendMessage).not.toHaveBeenCalled();

    // Should send retryExhausted notification
    expect(mockSendNotification).toHaveBeenCalled();
  });

  it('does NOT retry auth errors (throws immediately)', async () => {
    setupWorkflowLookup({
      id: 'wf-1',
      maestroWorkflowId: 'maestro-wf-1',
      connectionId: 'conn-1',
    });
    mockLaunchWorkflow.mockRejectedValueOnce(new Error('401 Unauthorized'));

    // Pipeline retry check (final failure path)
    mockSend.mockResolvedValueOnce({ Item: { status: 'pending' } });
    // Pipeline failure update
    mockSend.mockResolvedValueOnce({});
    // Rule failure
    mockSend.mockResolvedValueOnce({ Item: { id: 'rule-1', orgId: 'org-1', timesTriggered: 3, failureCount: 0 } });
    mockSend.mockResolvedValueOnce({});
    // Workflow name for notification
    mockSend.mockResolvedValueOnce({ Item: { name: 'My Workflow' } });

    await expect(processWorkflowLaunchJob(baseJob)).rejects.toThrow('401 Unauthorized');

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('does NOT retry validation errors (throws immediately)', async () => {
    setupWorkflowLookup({
      id: 'wf-1',
      maestroWorkflowId: 'maestro-wf-1',
      connectionId: 'conn-1',
    });
    mockLaunchWorkflow.mockRejectedValueOnce(new Error('400 validation failed'));

    mockSend.mockResolvedValueOnce({ Item: { status: 'pending' } });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({ Item: { id: 'rule-1', orgId: 'org-1', timesTriggered: 3, failureCount: 0 } });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({ Item: { name: 'My Workflow' } });

    await expect(processWorkflowLaunchJob(baseJob)).rejects.toThrow('400 validation');

    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

// ─── Retry Abandonment ──────────────────────────────────────

describe('processWorkflowLaunchJob — retry abandonment', () => {
  it('abandons retry if instance is already completed', async () => {
    // Instance lookup returns completed status
    mockSend.mockResolvedValueOnce({
      Item: { id: 'inst-1', status: 'completed', retrySequenceId: 'seq-1' },
    });

    const jobWithRetry = {
      ...baseJob,
      retry: {
        attempt: 3,
        maxAttempts: 6,
        sequenceId: 'seq-1',
        instanceId: 'inst-1',
      },
    };

    await processWorkflowLaunchJob(jobWithRetry);

    // Should not attempt launch
    expect(mockLaunchWorkflow).not.toHaveBeenCalled();
  });

  it('abandons retry if sequence ID changed (manual retry)', async () => {
    // Instance has a different sequence ID (user triggered manual retry)
    mockSend.mockResolvedValueOnce({
      Item: { id: 'inst-1', status: 'running', retrySequenceId: 'new-seq-from-manual' },
    });

    const jobWithRetry = {
      ...baseJob,
      retry: {
        attempt: 3,
        maxAttempts: 6,
        sequenceId: 'old-seq',
        instanceId: 'inst-1',
      },
    };

    await processWorkflowLaunchJob(jobWithRetry);

    expect(mockLaunchWorkflow).not.toHaveBeenCalled();
  });

  it('re-parks deferred retry when time has not arrived yet', async () => {
    const futureTime = new Date(Date.now() + 600_000).toISOString(); // 10min from now

    const jobWithDefer = {
      ...baseJob,
      retry: {
        attempt: 6,
        maxAttempts: 6,
        sequenceId: 'seq-1',
        instanceId: 'inst-1',
        deferUntil: futureTime,
      },
    };

    await processWorkflowLaunchJob(jobWithDefer);

    // Should re-park, not process
    expect(mockSendMessage).toHaveBeenCalledWith(
      'workflow-launcher',
      jobWithDefer,
      expect.objectContaining({ delaySeconds: expect.any(Number) }),
    );
    expect(mockLaunchWorkflow).not.toHaveBeenCalled();
  });
});

// ─── Retry on success updates existing instance ─────────────

describe('processWorkflowLaunchJob — retry success', () => {
  it('updates existing instance on successful retry (does not create new)', async () => {
    // Instance guard lookup
    mockSend.mockResolvedValueOnce({
      Item: { id: 'inst-1', status: 'running', retrySequenceId: 'seq-1' },
    });
    // Workflow lookup
    mockSend.mockResolvedValueOnce({
      Item: { id: 'wf-1', maestroWorkflowId: 'maestro-wf-1', connectionId: 'conn-1' },
    });
    mockLaunchWorkflow.mockResolvedValueOnce({
      instanceId: 'maestro-new',
      instanceUrl: 'https://example.com/new',
    });
    // UpdateCommand for existing instance (retry success path)
    mockSend.mockResolvedValueOnce({});
    // Pipeline update
    mockSend.mockResolvedValueOnce({});
    // Rule success (no workflow stats update on retry)
    mockSend.mockResolvedValueOnce({ Item: { id: 'rule-1', timesTriggered: 10, failureCount: 1 } });
    mockSend.mockResolvedValueOnce({});

    const jobWithRetry = {
      ...baseJob,
      retry: {
        attempt: 2,
        maxAttempts: 6,
        sequenceId: 'seq-1',
        instanceId: 'inst-1',
      },
    };

    await processWorkflowLaunchJob(jobWithRetry);

    expect(mockLaunchWorkflow).toHaveBeenCalled();

    // Verify it updated (not created) with maestroInstanceId
    const updateCalls = mockSend.mock.calls.filter(
      (call) => call[0]?.input?.ExpressionAttributeValues?.[':mid'] === 'maestro-new',
    );
    expect(updateCalls.length).toBe(1);
  });
});

// ─── Auto-pause ──────────────────────────────────────────────

describe('processWorkflowLaunchJob — auto-pause', () => {
  it('auto-pauses rule when failure rate > 50% over 5+ triggers', async () => {
    setupWorkflowLookup({
      id: 'wf-1',
      maestroWorkflowId: 'maestro-wf-1',
      connectionId: 'conn-1',
    });
    // Auth error — non-retryable, goes straight to final failure
    mockLaunchWorkflow.mockRejectedValueOnce(new Error('401 Unauthorized'));

    // Pipeline retry check (isRetry = false)
    mockSend.mockResolvedValueOnce({ Item: { id: 'pipe-1', status: 'pending' } });
    // Pipeline failure update
    mockSend.mockResolvedValueOnce({});
    // Rule lookup — high failure rate scenario (6 triggers, 3 already failed → +1 = 4/6 = 33%)
    mockSend.mockResolvedValueOnce({
      Item: { id: 'rule-1', orgId: 'org-1', name: 'Bad Rule', timesTriggered: 6, failureCount: 3 },
    });
    // Rule failure update
    mockSend.mockResolvedValueOnce({});
    // Auto-pause update (status → error)
    mockSend.mockResolvedValueOnce({});
    // getOrgAdmin for rule-paused notification
    // (note: getOrgAdmin is mocked globally to return 'admin-1')
    // Workflow name for failure notification
    mockSend.mockResolvedValueOnce({ Item: { name: 'My Workflow' } });

    await expect(processWorkflowLaunchJob(baseJob)).rejects.toThrow('401 Unauthorized');

    const autoPauseCall = mockSend.mock.calls.find(
      (call) =>
        call[0]?.input?.ExpressionAttributeValues?.[':status'] === 'error' &&
        call[0]?.input?.TableName === 'rules',
    );
    expect(autoPauseCall).toBeDefined();
  });
});

// ─── Exported test helpers ──────────────────────────────────

describe('_testExports', () => {
  it('formatDelay formats correctly', async () => {
    const { _testExports } = await import('../../workers/workflow-launcher.worker');
    expect(_testExports.formatDelay(2)).toBe('2s');
    expect(_testExports.formatDelay(300)).toBe('5min');
    expect(_testExports.formatDelay(1800)).toBe('30min');
  });

  it('RETRY_DELAYS_SEC has 6 entries', async () => {
    const { _testExports } = await import('../../workers/workflow-launcher.worker');
    expect(_testExports.RETRY_DELAYS_SEC).toEqual([2, 4, 8, 300, 900, 1800]);
    expect(_testExports.MAX_RETRY_ATTEMPTS).toBe(6);
  });
});
