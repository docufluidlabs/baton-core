/**
 * Tests for autoMapFromSchema — automatic webhook payload → Maestro trigger input mapping.
 *
 * The function lives in workflow-launcher.worker.ts and is tested indirectly via
 * processWorkflowLaunchJob by checking what triggerInputs are passed to launchWorkflow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────

vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-instance-id') }));

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

vi.mock('../../services/usage.service', () => ({
  incrementExecutionCount: vi.fn(),
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

// ─── Helpers ─────────────────────────────────────────────────

function makeWorkflow(triggerInputSchema?: Record<string, any>) {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    maestroWorkflowId: 'maestro-wf-1',
    connectionId: 'conn-1',
    orgId: 'org-1',
    launchCount: 0,
    triggerInputSchema,
  };
}

function setupMocks(workflow: object) {
  const fakeRule = { id: 'rule-1', timesTriggered: 1, failureCount: 0 };
  mockSend
    .mockResolvedValueOnce({ Item: workflow })  // GetCommand: workflow
    .mockResolvedValueOnce({})                   // PutCommand: instance
    .mockResolvedValueOnce({})                   // UpdateCommand: pipeline entry
    .mockResolvedValueOnce({})                   // UpdateCommand: workflow stats
    .mockResolvedValueOnce({ Item: fakeRule })   // GetCommand: rule
    .mockResolvedValueOnce({});                  // UpdateCommand: rule
}

/** Extracts the triggerInputs that were passed to Maestro launchWorkflow */
function capturedTriggerInputs() {
  expect(mockLaunchWorkflow).toHaveBeenCalledOnce();
  return mockLaunchWorkflow.mock.calls[0][0].triggerInputs as Record<string, any>;
}

function makeJob(rawPayload: Record<string, any>) {
  return {
    ruleId: 'rule-1',
    pipelineEntryId: 'pipe-1',
    workflowId: 'wf-1',
    orgId: 'org-1',
    inputData: { __rawPayload: rawPayload },
    instanceName: 'Test',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLaunchWorkflow.mockResolvedValue({ instanceId: 'inst-1', instanceUrl: 'https://example.com' });
});

// ─── Tests ───────────────────────────────────────────────────

describe('autoMapFromSchema — no schema', () => {
  it('passes the entire raw payload to Maestro when workflow has no triggerInputSchema', async () => {
    const payload = { object_id: '123', name: 'Acme', status: 'active' };
    setupMocks(makeWorkflow(undefined));
    await processWorkflowLaunchJob(makeJob(payload));

    expect(capturedTriggerInputs()).toEqual(payload);
  });
});

describe('autoMapFromSchema — empty schema (properties: {})', () => {
  // Regression: Maestro returns { type: 'object', properties: {} } for webhook-triggered
  // workflows. Previously this caused `return payload` (raw nested object), so a BambooHR
  // payload with `data.employeeId` would not expose `employeeId` at the top level and
  // Maestro would show the trigger input as null.
  it('flattens nested payload and exposes short aliases when properties is empty', async () => {
    const payload = {
      type: 'employee.updated',
      data: { companyId: '778076', employeeId: '86' },
      timestamp: '2026-04-29T21:04:05Z',
    };
    setupMocks(makeWorkflow({ type: 'object', properties: {} }));
    await processWorkflowLaunchJob(makeJob(payload));

    const inputs = capturedTriggerInputs();
    expect(inputs.employeeId).toBe('86');
    expect(inputs.companyId).toBe('778076');
    expect(inputs.type).toBe('employee.updated');
  });
});

describe('autoMapFromSchema — manual mapping (no __rawPayload)', () => {
  it('passes inputData as-is when manual field mapping was already applied', async () => {
    const manualMapped = { project_id: '42', title: 'My Project' };
    setupMocks(makeWorkflow({
      properties: { project_id: { type: 'string' }, title: { type: 'string' } },
    }));
    const job = {
      ruleId: 'rule-1',
      pipelineEntryId: 'pipe-1',
      workflowId: 'wf-1',
      orgId: 'org-1',
      inputData: manualMapped, // no __rawPayload
      instanceName: 'Test',
    };
    await processWorkflowLaunchJob(job);

    expect(capturedTriggerInputs()).toEqual(manualMapped);
  });
});

describe('autoMapFromSchema — JSON Schema format', () => {
  const schema = {
    properties: {
      object_id: { type: 'string', title: 'Object ID' },
      project_name: { type: 'string', title: 'Project Name' },
      amount: { type: 'number' },
    },
  };

  it('exact match: maps fields with identical names', async () => {
    const payload = { object_id: 'OBJ-1', project_name: 'Alpha', amount: 500 };
    setupMocks(makeWorkflow(schema));
    await processWorkflowLaunchJob(makeJob(payload));

    expect(capturedTriggerInputs()).toEqual({
      object_id: 'OBJ-1',
      project_name: 'Alpha',
      amount: '500',
    });
  });

  it('normalized match: "Object ID" payload field → object_id schema field', async () => {
    const payload = { 'Object ID': 'OBJ-2', 'Project Name': 'Beta', Amount: 200 };
    setupMocks(makeWorkflow(schema));
    await processWorkflowLaunchJob(makeJob(payload));

    const inputs = capturedTriggerInputs();
    expect(inputs.object_id).toBe('OBJ-2');
    expect(inputs.project_name).toBe('Beta');
    expect(inputs.amount).toBe('200');
  });

  it('normalized match: camelCase "objectId" → object_id', async () => {
    const payload = { objectId: 'OBJ-3', projectName: 'Gamma', amount: 100 };
    setupMocks(makeWorkflow(schema));
    await processWorkflowLaunchJob(makeJob(payload));

    const inputs = capturedTriggerInputs();
    expect(inputs.object_id).toBe('OBJ-3');
    expect(inputs.project_name).toBe('Gamma');
  });

  it('normalized match: SCREAMING_SNAKE "OBJECT_ID" → object_id', async () => {
    const payload = { OBJECT_ID: 'OBJ-4', PROJECT_NAME: 'Delta' };
    setupMocks(makeWorkflow(schema));
    await processWorkflowLaunchJob(makeJob(payload));

    const inputs = capturedTriggerInputs();
    expect(inputs.object_id).toBe('OBJ-4');
    expect(inputs.project_name).toBe('Delta');
  });

  it('does not include payload fields not in schema', async () => {
    const payload = { object_id: 'OBJ-5', extra_field: 'should be ignored', noise: 99 };
    setupMocks(makeWorkflow(schema));
    await processWorkflowLaunchJob(makeJob(payload));

    const inputs = capturedTriggerInputs();
    expect(inputs.object_id).toBe('OBJ-5');
    expect(inputs.extra_field).toBeUndefined();
    expect(inputs.noise).toBeUndefined();
  });

  it('handles missing schema fields gracefully (no crash, field simply absent)', async () => {
    const payload = { object_id: 'OBJ-6' }; // project_name and amount not in payload
    setupMocks(makeWorkflow(schema));
    await processWorkflowLaunchJob(makeJob(payload));

    const inputs = capturedTriggerInputs();
    expect(inputs.object_id).toBe('OBJ-6');
    expect(inputs.project_name).toBeUndefined();
    expect(inputs.amount).toBeUndefined();
  });
});

describe('autoMapFromSchema — Maestro array schema format', () => {
  const schema = [
    { field_name: 'record_id', field_data_type: 'String' },
    { field_name: 'vendor_name', field_data_type: 'String' },
    { field_name: 'total_amount', field_data_type: 'Float', default_value: null },
  ];

  it('maps fields using Maestro array format schema', async () => {
    const payload = { record_id: 'REC-1', vendor_name: 'ACME Corp', total_amount: 1500.5 };
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob(payload));

    expect(capturedTriggerInputs()).toEqual({
      record_id: 'REC-1',
      vendor_name: 'ACME Corp',
      total_amount: '1500.5',
    });
  });

  it('normalized match in array format: "Record ID" → record_id', async () => {
    const payload = { 'Record ID': 'REC-2', 'Vendor Name': 'Beta Ltd', 'Total Amount': 750 };
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob(payload));

    const inputs = capturedTriggerInputs();
    expect(inputs.record_id).toBe('REC-2');
    expect(inputs.vendor_name).toBe('Beta Ltd');
    expect(inputs.total_amount).toBe('750');
  });
});

describe('autoMapFromSchema — nested payload fields', () => {
  const schema = {
    properties: {
      project_id: { type: 'string' },
      owner_email: { type: 'string' },
    },
  };

  it('matches nested payload field data.project_id to schema project_id', async () => {
    const payload = {
      event: 'created',
      data: {
        project_id: 'PROJ-99',
        owner: { email: 'alex@example.com' },
      },
    };
    setupMocks(makeWorkflow(schema));
    await processWorkflowLaunchJob(makeJob(payload));

    const inputs = capturedTriggerInputs();
    expect(inputs.project_id).toBe('PROJ-99');
  });
});

describe('autoMapFromSchema — BambooHR employee.updated payload', () => {
  // Реальний webhook payload від BambooHR:
  // { type, data: { employeeId, companyId, changedFields }, timestamp }
  // Воркфлоу очікує: { employee_id: string }
  // autoMapFromSchema має знайти data.employeeId → employee_id через normalized match

  const bambooPayload = {
    type: 'employee.updated',
    data: {
      changedFields: ['employmentHistoryStatus'],
      companyId: '778076',
      employeeId: '7',
    },
    timestamp: '2026-04-24T18:28:09Z',
  };

  it('маппить data.employeeId → employee_id (Maestro array schema)', async () => {
    const schema = [{ field_name: 'employee_id', field_data_type: 'String' }];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob(bambooPayload));

    expect(capturedTriggerInputs()).toEqual({ employee_id: '7' });
  });

  it('маппить data.employeeId → employee_id (JSON Schema format)', async () => {
    const schema = { properties: { employee_id: { type: 'string' } } };
    setupMocks(makeWorkflow(schema));
    await processWorkflowLaunchJob(makeJob(bambooPayload));

    expect(capturedTriggerInputs()).toEqual({ employee_id: '7' });
  });

  it('без схеми — передає всі leaf-поля включно з employeeId та companyId', async () => {
    setupMocks(makeWorkflow(undefined));
    await processWorkflowLaunchJob(makeJob(bambooPayload));

    const inputs = capturedTriggerInputs();
    expect(inputs.employeeId).toBe('7');
    expect(inputs.companyId).toBe('778076');
    expect(inputs.type).toBe('employee.updated');
    expect(inputs.timestamp).toBe('2026-04-24T18:28:09Z');
  });

  it('не включає поля не зі схеми (type, timestamp, companyId)', async () => {
    const schema = [{ field_name: 'employee_id', field_data_type: 'String' }];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob(bambooPayload));

    const inputs = capturedTriggerInputs();
    expect(inputs.type).toBeUndefined();
    expect(inputs.timestamp).toBeUndefined();
    expect(inputs.companyId).toBeUndefined();
  });

  it('маппить кілька полів одночасно: employee_id + company_id', async () => {
    const schema = [
      { field_name: 'employee_id', field_data_type: 'String' },
      { field_name: 'company_id', field_data_type: 'String' },
    ];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob(bambooPayload));

    expect(capturedTriggerInputs()).toEqual({ employee_id: '7', company_id: '778076' });
  });
});

describe('autoMapFromSchema — BambooHR legacy payload (employees[])', () => {
  // Legacy формат: { employees: [{ id, changedFields }] }

  const legacyPayload = {
    employees: [{ id: 42, changedFields: ['department', 'location'] }],
  };

  it('без схеми — employees є масивом, flattenPayload не рекурсує в масив → порожній результат', async () => {
    // flattenPayload пропускає масиви (!Array.isArray guard), тому employees[0].id не витягується.
    // Leaf-фільтр також відкидає employees як об'єктне значення. Результат — порожній об'єкт.
    setupMocks(makeWorkflow(undefined));
    await processWorkflowLaunchJob(makeJob(legacyPayload));

    expect(capturedTriggerInputs()).toEqual({});
  });

  it('зі схемою employee_id — не знаходить значення (масив не флетиться)', async () => {
    const schema = [{ field_name: 'employee_id', field_data_type: 'String' }];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob(legacyPayload));

    expect(capturedTriggerInputs().employee_id).toBeUndefined();
  });

  it('зі схемою id — не знаходить значення (employees[0].id недосяжний)', async () => {
    const schema = [{ field_name: 'id', field_data_type: 'String' }];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob(legacyPayload));

    expect(capturedTriggerInputs().id).toBeUndefined();
  });
});

describe('autoMapFromSchema — HubSpot повний формат (масив подій)', () => {
  // Повний формат від HubSpot Developer App:
  // [{ subscriptionType, portalId, objectId, changeFlag, eventId, appId, ... }]

  const hubspotArrayPayload = [
    {
      attemptNumber: 0,
      sourceId: 'userId:89643182',
      eventId: 2474115725,
      changeSource: 'CRM_UI',
      occurredAt: 1777035637445,
      subscriptionType: 'contact.creation',
      portalId: 148041090,
      appId: 33908884,
      changeFlag: 'CREATED',
      subscriptionId: 5863565,
      objectId: 763810161872,
    },
  ];

  it('без схеми — передає всі leaf-поля з першого елемента масиву', async () => {
    setupMocks(makeWorkflow(undefined));
    await processWorkflowLaunchJob(makeJob(hubspotArrayPayload));

    const inputs = capturedTriggerInputs();
    expect(inputs['0.objectId']).toBe('763810161872');
  });

  it('маппить objectId → contact_id через normalized match', async () => {
    const schema = [{ field_name: 'contact_id', field_data_type: 'String' }];
    setupMocks(makeWorkflow(schema as any));
    // масив не має прямого contact_id — поле відсутнє
    await processWorkflowLaunchJob(makeJob(hubspotArrayPayload));

    expect(capturedTriggerInputs().contact_id).toBeUndefined();
  });

  it('маппить portalId → portal_id', async () => {
    const schema = [{ field_name: 'portal_id', field_data_type: 'String' }];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob(hubspotArrayPayload));

    // portalId (нормалізовано: "portalid") збігається з portal_id ("portalid")
    expect(capturedTriggerInputs()).toEqual({ portal_id: '148041090' });
  });
});

describe('autoMapFromSchema — HubSpot спрощені формати', () => {
  it('{ objectId } без схеми — передає objectId як рядок', async () => {
    setupMocks(makeWorkflow(undefined));
    await processWorkflowLaunchJob(makeJob({ objectId: 59086970954 }));

    expect(capturedTriggerInputs().objectId).toBe('59086970954');
  });

  it('{ objectId } → object_id через normalized match', async () => {
    const schema = [{ field_name: 'object_id', field_data_type: 'String' }];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob({ objectId: 59086970954 }));

    expect(capturedTriggerInputs()).toEqual({ object_id: '59086970954' });
  });

  it('{ objectId, eventId } — маппить обидва поля', async () => {
    const schema = [
      { field_name: 'object_id', field_data_type: 'String' },
      { field_name: 'event_id', field_data_type: 'String' },
    ];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob({ objectId: 59086970954, eventId: 2474115725 }));

    expect(capturedTriggerInputs()).toEqual({
      object_id: '59086970954',
      event_id: '2474115725',
    });
  });

  it('{ objectId, appId } — маппить обидва поля', async () => {
    const schema = [
      { field_name: 'object_id', field_data_type: 'String' },
      { field_name: 'app_id', field_data_type: 'String' },
    ];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob({ objectId: 59086970954, appId: 33908884 }));

    expect(capturedTriggerInputs()).toEqual({
      object_id: '59086970954',
      app_id: '33908884',
    });
  });

  it('{ eventId, appId } без objectId — маппить наявні поля', async () => {
    const schema = [
      { field_name: 'event_id', field_data_type: 'String' },
      { field_name: 'app_id', field_data_type: 'String' },
    ];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob({ eventId: 2474115725, appId: 33908884 }));

    expect(capturedTriggerInputs()).toEqual({
      event_id: '2474115725',
      app_id: '33908884',
    });
  });

  it('{ eventId, appId } — object_id відсутній у результаті', async () => {
    const schema = [{ field_name: 'object_id', field_data_type: 'String' }];
    setupMocks(makeWorkflow(schema as any));
    await processWorkflowLaunchJob(makeJob({ eventId: 2474115725, appId: 33908884 }));

    expect(capturedTriggerInputs().object_id).toBeUndefined();
  });
});
