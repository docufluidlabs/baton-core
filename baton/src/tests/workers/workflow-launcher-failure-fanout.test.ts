/**
 * Tests for the launch-failure notification fan-out in workflow-launcher.worker.ts.
 *
 * When a workflow launched by automation fails (and is non-retryable / out of retries),
 * every org admin should receive an in-app + email notification, while Slack should
 * post once per org (the channel is per-org, not per-user).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────

vi.mock('uuid', () => ({ v4: vi.fn(() => 'inst-uuid-fanout') }));

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: {
    WORKFLOWS: 'workflows',
    WORKFLOW_INSTANCES: 'workflow-instances',
    TRIGGER_PIPELINE: 'trigger-pipeline',
    AUTOMATION_RULES: 'automation-rules',
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

vi.mock('../../services/usage.service', () => ({
  incrementExecutionCount: vi.fn(),
}));

const mockSendNotification = vi.fn();
vi.mock('../../services/notification.service', () => ({
  sendNotification: (...args: any[]) => mockSendNotification(...args),
  workflowFailedNotification: vi.fn((orgId, recipientId, workflowName, instanceId, errorMessage, extra) => ({
    type: 'wf_failed', orgId, recipientId, workflowName, instanceId, errorMessage, extra,
  })),
  rulePausedNotification: vi.fn(() => ({ type: 'rule_paused' })),
  retryExhaustedNotification: vi.fn((orgId, recipientId, workflowName, instanceId, max, extra) => ({
    type: 'retry_exhausted', orgId, recipientId, workflowName, instanceId, max, extra,
  })),
}));

vi.mock('../../queue/sqs-client', () => ({
  sendMessage: vi.fn(),
  QueueNames: { WORKFLOW_LAUNCHER: 'workflow-launcher' },
}));

const mockGetOrgAdmins = vi.fn();
vi.mock('../../services/user.service', () => ({
  getOrgAdmin: vi.fn().mockResolvedValue('admin-1'),
  getOrgAdmins: (...args: any[]) => mockGetOrgAdmins(...args),
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })),
}));

import { processWorkflowLaunchJob } from '../../workers/workflow-launcher.worker';

// ─── Fixtures ────────────────────────────────────────────────

const fakeWorkflow = {
  id: 'wf-1',
  name: 'My Workflow',
  maestroWorkflowId: 'maestro-wf-1',
  connectionId: 'conn-1',
  orgId: 'org-1',
};

const fakePipelineEntry = {
  id: 'pipe-1',
  ruleId: 'rule-1',
  actionNumber: 2,
  sourcePlatform: 'bamboohr',
  status: 'pending',
};

const fakeRule = { id: 'rule-1', name: 'Onboard new hire', timesTriggered: 5, failureCount: 0 };

const baseJob = {
  ruleId: 'rule-1',
  pipelineEntryId: 'pipe-1',
  workflowId: 'wf-1',
  orgId: 'org-1',
  inputData: { key: 'value' },
  instanceName: 'Test Instance',
  requestId: 'req-1',
};

/**
 * The launcher does many DynamoDB calls along the failure path (pipeline lookup +
 * update, updateRuleFailure get/update, workflow + pipeline + rule lookup for the
 * notification). Rather than ordering every Once-mock, route by TableName and
 * UpdateExpression so the test stays readable and resilient to ordering changes.
 */
function routeDynamoCalls() {
  mockSend.mockImplementation(async (cmd: any) => {
    const tn = cmd.input?.TableName;
    const isUpdate = !!cmd.input?.UpdateExpression && !cmd.input?.Item;
    if (tn === 'workflows' && !isUpdate) return { Item: fakeWorkflow };
    if (tn === 'trigger-pipeline' && !isUpdate) return { Item: fakePipelineEntry };
    if (tn === 'automation-rules' && !isUpdate) return { Item: fakeRule };
    return {}; // updates / puts succeed silently
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 401 / invalid credentials → categorized as 'auth' → non-retryable
  mockLaunchWorkflow.mockRejectedValue(new Error('401 invalid credentials'));
  routeDynamoCalls();
});

// ─── Tests ───────────────────────────────────────────────────

describe('launch-failure notification fan-out', () => {
  it('fans out to every org admin', async () => {
    mockGetOrgAdmins.mockResolvedValueOnce(['admin-1', 'admin-2', 'admin-3']);

    // Non-retryable, first attempt → worker re-throws after sending notifications
    await expect(processWorkflowLaunchJob(baseJob)).rejects.toThrow();

    expect(mockGetOrgAdmins).toHaveBeenCalledWith('org-1');
    expect(mockSendNotification).toHaveBeenCalledTimes(3);

    const recipients = mockSendNotification.mock.calls.map((c) => c[0].recipientId);
    expect(recipients).toEqual(['admin-1', 'admin-2', 'admin-3']);
  });

  it('routes Slack once per org by overriding channels for non-first recipients', async () => {
    mockGetOrgAdmins.mockResolvedValueOnce(['admin-1', 'admin-2', 'admin-3']);

    await expect(processWorkflowLaunchJob(baseJob)).rejects.toThrow();

    // First admin: channels left undefined → notification.service uses prefs (Slack included)
    expect(mockSendNotification.mock.calls[0][0].channels).toBeUndefined();
    // Subsequent admins: forced to in_app + email so Slack isn't double-posted
    expect(mockSendNotification.mock.calls[1][0].channels).toEqual(['in_app', 'email']);
    expect(mockSendNotification.mock.calls[2][0].channels).toEqual(['in_app', 'email']);
  });

  it('skips notification entirely when org has no admins', async () => {
    mockGetOrgAdmins.mockResolvedValueOnce([]);

    await expect(processWorkflowLaunchJob(baseJob)).rejects.toThrow();

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('handles a single admin without forcing channel override', async () => {
    mockGetOrgAdmins.mockResolvedValueOnce(['admin-only']);

    await expect(processWorkflowLaunchJob(baseJob)).rejects.toThrow();

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification.mock.calls[0][0].recipientId).toBe('admin-only');
    expect(mockSendNotification.mock.calls[0][0].channels).toBeUndefined();
  });
});
