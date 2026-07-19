import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const mockGetConnection = vi.fn();
const mockGetAccessToken = vi.fn();
const mockGetRefreshToken = vi.fn();
const mockUpdateTokens = vi.fn();

vi.mock('../../services/connection.service', () => ({
  getConnection: (...args: any[]) => mockGetConnection(...args),
  getAccessToken: (...args: any[]) => mockGetAccessToken(...args),
  getRefreshToken: (...args: any[]) => mockGetRefreshToken(...args),
  updateTokens: (...args: any[]) => mockUpdateTokens(...args),
}));

const mockRefreshToken = vi.fn();
vi.mock('../../services/connectors', () => ({
  getConnector: vi.fn(() => ({ refreshToken: mockRefreshToken })),
}));

vi.mock('../../env', () => ({
  default: {
    DOCUSIGN_ACCOUNT_ID: 'test-account-id',
    DOCUSIGN_MAESTRO_API_BASE: 'https://api-d.docusign.com',
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  listWorkflows,
  getTriggerRequirements,
  launchWorkflow,
  getInstances,
  getInstance,
  cancelInstance,
  _testExports,
} from '../../services/maestro.service';

const { getValidAccessToken } = _testExports;

// ─── Helpers ──────────────────────────────────────────────────

function setupValidConnection() {
  const futureDate = new Date(Date.now() + 3600000).toISOString();
  mockGetConnection.mockResolvedValue({
    platform: 'docusign',
    accountId: 'acc-123',
    tokenExpiresAt: futureDate,
  });
  mockGetAccessToken.mockResolvedValue('test-access-token');
}

function okJsonResponse(body: any) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: async () => body,
  };
}

// ─── Tests ────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getValidAccessToken', () => {
  it('throws when connection is not found', async () => {
    mockGetConnection.mockResolvedValue(null);

    await expect(getValidAccessToken('conn-1')).rejects.toThrow('not found');
  });

  it('throws when connection is not a DocuSign connection', async () => {
    mockGetConnection.mockResolvedValue({ platform: 'salesforce' });

    await expect(getValidAccessToken('conn-1')).rejects.toThrow('not a DocuSign');
  });

  it('refreshes an expired token and returns new accessToken', async () => {
    const pastDate = new Date(Date.now() - 60000).toISOString();
    mockGetConnection.mockResolvedValue({
      platform: 'docusign',
      accountId: 'acc-123',
      tokenExpiresAt: pastDate,
    });
    mockGetRefreshToken.mockResolvedValue('refresh-tok');

    const now = Date.now();
    mockRefreshToken.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
      createdAt: now,
    });
    mockUpdateTokens.mockResolvedValue(undefined);

    const result = await getValidAccessToken('conn-1');

    expect(mockGetRefreshToken).toHaveBeenCalledWith('conn-1');
    expect(mockRefreshToken).toHaveBeenCalledWith('refresh-tok');
    expect(mockUpdateTokens).toHaveBeenCalledWith('conn-1', {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
      createdAt: now,
    });
    expect(result).toEqual({
      accessToken: 'new-access',
      accountId: 'acc-123',
      apiBase: 'https://api-d.docusign.com',
    });
  });

  it('returns existing accessToken when token is still valid', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    mockGetConnection.mockResolvedValue({
      platform: 'docusign',
      accountId: 'acc-123',
      tokenExpiresAt: futureDate,
    });
    mockGetAccessToken.mockResolvedValue('valid-access');

    const result = await getValidAccessToken('conn-1');

    expect(mockGetAccessToken).toHaveBeenCalledWith('conn-1');
    expect(mockRefreshToken).not.toHaveBeenCalled();
    expect(result).toEqual({
      accessToken: 'valid-access',
      accountId: 'acc-123',
      apiBase: 'https://api-d.docusign.com',
    });
  });

  it('calls getAccessToken directly when tokenExpiresAt is missing', async () => {
    mockGetConnection.mockResolvedValue({
      platform: 'docusign',
      accountId: 'acc-123',
      // no tokenExpiresAt
    });
    mockGetAccessToken.mockResolvedValue('fallback-access');

    const result = await getValidAccessToken('conn-1');

    expect(mockGetAccessToken).toHaveBeenCalledWith('conn-1');
    expect(mockRefreshToken).not.toHaveBeenCalled();
    expect(result).toEqual({
      accessToken: 'fallback-access',
      accountId: 'acc-123',
      apiBase: 'https://api-d.docusign.com',
    });
  });
});

describe('listWorkflows', () => {
  it('returns mapped workflow array on success', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(
      okJsonResponse({
        data: [
          { id: 'w1', name: 'WF1', status: 'active', description: 'desc' },
          { id: 'w2', name: 'WF2', status: 'active', description: 'desc2' },
        ],
      }),
    );

    const result = await listWorkflows('conn-1');

    expect(result).toEqual([
      { id: 'w1', name: 'WF1', status: 'active', description: 'desc' },
      { id: 'w2', name: 'WF2', status: 'active', description: 'desc2' },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api-d.docusign.com/v1/accounts/acc-123/workflows',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
      }),
    );
  });

  it('filters workflows by status', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(
      okJsonResponse({
        data: [
          { id: 'w1', name: 'WF1', status: 'active', description: 'a' },
          { id: 'w2', name: 'WF2', status: 'draft', description: 'b' },
          { id: 'w3', name: 'WF3', status: 'active', description: 'c' },
        ],
      }),
    );

    const result = await listWorkflows('conn-1', 'active');

    expect(result).toHaveLength(2);
    expect(result.every((w) => w.status === 'active')).toBe(true);
  });

  it('throws on non-ok response', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));

    await expect(listWorkflows('conn-1')).rejects.toThrow('Failed to list workflows');
  });
});

describe('getTriggerRequirements', () => {
  it('returns mapped trigger requirements on success', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(
      okJsonResponse({
        trigger_event_type: 'http',
        trigger_http_config: { url: 'https://example.com' },
        trigger_input_schema: { type: 'object', properties: {} },
      }),
    );

    const result = await getTriggerRequirements('conn-1', 'wf-1');

    expect(result).toEqual({
      triggerEventType: 'http',
      triggerHttpConfig: { url: 'https://example.com' },
      triggerInputSchema: { type: 'object', properties: {} },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api-d.docusign.com/v1/accounts/acc-123/workflows/wf-1/trigger-requirements',
      expect.any(Object),
    );
  });

  it('throws on non-ok response', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(errorResponse(404, 'Not Found'));

    await expect(getTriggerRequirements('conn-1', 'wf-1')).rejects.toThrow(
      'Failed to get trigger requirements',
    );
  });
});

describe('launchWorkflow', () => {
  const launchParams = {
    connectionId: 'conn-1',
    workflowId: 'wf-1',
    instanceName: 'Test Launch',
    triggerInputs: { key: 'value' },
  };

  it('returns instanceId and instanceUrl on success', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(
      okJsonResponse({
        instance_id: 'inst-1',
        instance_url: 'https://example.com/instances/inst-1',
      }),
    );

    const result = await launchWorkflow(launchParams);

    expect(result).toEqual({
      instanceId: 'inst-1',
      instanceUrl: 'https://example.com/instances/inst-1',
    });
  });

  it('sends correct body with instance_name and trigger_inputs', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(
      okJsonResponse({ instance_id: 'inst-1', instance_url: 'https://example.com' }),
    );

    await launchWorkflow(launchParams);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api-d.docusign.com/v1/accounts/acc-123/workflows/wf-1/actions/trigger',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          instance_name: 'Test Launch',
          trigger_inputs: { key: 'value' },
        }),
      }),
    );
  });

  it('throws on non-ok response', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(errorResponse(400, 'Bad Request'));

    await expect(launchWorkflow(launchParams)).rejects.toThrow('Failed to launch workflow');
  });
});

describe('getInstances', () => {
  it('returns mapped instances on success', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(
      okJsonResponse({
        instances: [
          {
            id: 'inst-1',
            name: 'Instance One',
            workflow_id: 'wf-1',
            workflow_name: 'WF One',
            workflow_status: 'Completed',
            last_completed_step_name: 'Step 3',
            started_at: '2025-01-01T00:00:00Z',
            ended_at: '2025-01-01T01:00:00Z',
            started_by_name: 'User A',
            total_steps: 3,
          },
        ],
      }),
    );

    const result = await getInstances('conn-1', 'wf-1');

    expect(result).toEqual([
      {
        id: 'inst-1',
        instanceName: 'Instance One',
        workflowId: 'wf-1',
        workflowName: 'WF One',
        status: 'completed',
        lastStep: 'Step 3',
        lastCompletedStep: undefined,
        lastCompletedStepName: 'Step 3',
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-01-01T01:00:00Z',
        instanceUrl: 'https://apps-d.docusign.com/maestro/accounts/acc-123/instances/inst-1',
        startedBy: undefined,
        startedByName: 'User A',
        totalSteps: 3,
      },
    ]);
  });

  it('normalizes "In Progress" status to "in_progress"', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(
      okJsonResponse({
        instances: [
          {
            id: 'inst-2',
            name: 'Running Instance',
            workflow_id: 'wf-1',
            workflow_status: 'In Progress',
            started_at: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    );

    const result = await getInstances('conn-1', 'wf-1');

    expect(result[0].status).toBe('in_progress');
  });

  it('throws on non-ok response', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(errorResponse(500, 'Server Error'));

    await expect(getInstances('conn-1', 'wf-1')).rejects.toThrow('Failed to get instances');
  });
});

describe('getInstance', () => {
  it('returns a single mapped instance on success', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(
      okJsonResponse({
        id: 'inst-1',
        name: 'Single Instance',
        workflow_id: 'wf-1',
        workflow_name: 'WF One',
        workflow_status: 'Completed',
        last_completed_step_name: 'Final Step',
        started_at: '2025-01-01T00:00:00Z',
        ended_at: '2025-01-01T02:00:00Z',
        started_by_name: 'User B',
        total_steps: 5,
      }),
    );

    const result = await getInstance('conn-1', 'wf-1', 'inst-1');

    expect(result).toEqual({
      id: 'inst-1',
      instanceName: 'Single Instance',
      workflowId: 'wf-1',
      workflowName: 'WF One',
      status: 'completed',
      lastStep: 'Final Step',
      lastCompletedStep: undefined,
      lastCompletedStepName: 'Final Step',
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-01T02:00:00Z',
      instanceUrl: 'https://apps-d.docusign.com/maestro/accounts/acc-123/instances/inst-1',
      startedBy: undefined,
      startedByName: 'User B',
      totalSteps: 5,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api-d.docusign.com/v1/accounts/acc-123/workflows/wf-1/instances/inst-1',
      expect.any(Object),
    );
  });

  it('throws on non-ok response', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(errorResponse(404, 'Not Found'));

    await expect(getInstance('conn-1', 'wf-1', 'inst-1')).rejects.toThrow(
      'Failed to get instance',
    );
  });
});

describe('cancelInstance', () => {
  it('completes without error on success', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(okJsonResponse({}));

    await expect(cancelInstance('conn-1', 'wf-1', 'inst-1')).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api-d.docusign.com/v1/accounts/acc-123/workflows/wf-1/instances/inst-1/actions/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-ok response', async () => {
    setupValidConnection();
    mockFetch.mockResolvedValue(errorResponse(409, 'Conflict'));

    await expect(cancelInstance('conn-1', 'wf-1', 'inst-1')).rejects.toThrow(
      'Failed to cancel instance',
    );
  });
});
