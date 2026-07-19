/**
 * Rule Engine CRUD + processEvent integration tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

const { mockSend, mockSendMessage } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockSendMessage: vi.fn(),
}));

vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: mockSend }),
  TableNames: {
    AUTOMATION_RULES: 'rules',
    TRIGGER_PIPELINE: 'pipeline',
  },
}));

vi.mock('../../queue/sqs-client', () => ({
  sendMessage: mockSendMessage,
  QueueNames: { WORKFLOW_LAUNCHER: 'wf-launcher' },
}));

import {
  createRule,
  getRule,
  getRulesByOrg,
  updateRuleStatus,
  deleteRule,
  findMatchingRules,
  processEvent,
} from '../../services/rule-engine.service';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createRule ─────────────────────────────────────────────

describe('createRule', () => {
  it('creates a rule with all fields and returns it', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await createRule({
      orgId: 'org-1',
      name: 'Test Rule',
      connectionId: 'conn-1',
      sourcePlatform: 'xero',
      eventType: 'invoice.created',
      eventLabel: 'Invoice Created',
      targetWorkflowId: 'wf-1',
    });

    expect(result).toMatchObject({
      orgId: 'org-1',
      name: 'Test Rule',
      connectionId: 'conn-1',
      sourcePlatform: 'xero',
      eventType: 'invoice.created',
      eventLabel: 'Invoice Created',
      actionType: 'launch_workflow',
      targetWorkflowId: 'wf-1',
      status: 'active',
      timesTriggered: 0,
      successRate: 100,
      failureCount: 0,
      retryMaxAttempts: 3,
      retryStrategy: 'exponential',
      retryIntervalSec: 60,
    });
    expect(result.id).toBeDefined();
    expect(result.createdAt).toBeDefined();
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('uses custom retry config when provided', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await createRule({
      orgId: 'org-1',
      name: 'Custom Retry',
      connectionId: 'conn-1',
      sourcePlatform: 'procore',
      eventType: 'vendor.created',
      eventLabel: 'Vendor Created',
      targetWorkflowId: 'wf-1',
      retryMaxAttempts: 5,
      retryStrategy: 'linear',
      retryIntervalSec: 30,
      actionConfig: { fieldMapping: { name: '$.vendorName' } },
    });

    expect(result.retryMaxAttempts).toBe(5);
    expect(result.retryStrategy).toBe('linear');
    expect(result.retryIntervalSec).toBe(30);
    expect(result.actionConfig).toEqual({ fieldMapping: { name: '$.vendorName' } });
  });
});

// ─── getRule ────────────────────────────────────────────────

describe('getRule', () => {
  it('returns rule when found', async () => {
    const fakeRule = { id: 'rule-1', name: 'My Rule' };
    mockSend.mockResolvedValueOnce({ Item: fakeRule });

    const result = await getRule('rule-1');
    expect(result).toEqual(fakeRule);
  });

  it('returns null when not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await getRule('missing');
    expect(result).toBeNull();
  });
});

// ─── getRulesByOrg ──────────────────────────────────────────

describe('getRulesByOrg', () => {
  it('returns array of rules for org', async () => {
    const rules = [{ id: 'r1' }, { id: 'r2' }];
    mockSend.mockResolvedValueOnce({ Items: rules });

    const result = await getRulesByOrg('org-1');
    expect(result).toEqual(rules);
  });

  it('returns empty array when no rules', async () => {
    mockSend.mockResolvedValueOnce({ Items: undefined });

    const result = await getRulesByOrg('org-empty');
    expect(result).toEqual([]);
  });
});

// ─── updateRuleStatus ───────────────────────────────────────

describe('updateRuleStatus', () => {
  it('sends UpdateCommand with correct status', async () => {
    mockSend.mockResolvedValueOnce({});

    await updateRuleStatus('rule-1', 'paused');
    expect(mockSend).toHaveBeenCalledOnce();

    const cmd = mockSend.mock.calls[0][0].input;
    expect(cmd.Key).toEqual({ id: 'rule-1' });
    expect(cmd.ExpressionAttributeValues[':status']).toBe('paused');
  });

  it('handles error status', async () => {
    mockSend.mockResolvedValueOnce({});

    await updateRuleStatus('rule-1', 'error');
    const cmd = mockSend.mock.calls[0][0].input;
    expect(cmd.ExpressionAttributeValues[':status']).toBe('error');
  });
});

// ─── deleteRule ─────────────────────────────────────────────

describe('deleteRule', () => {
  it('soft-deletes by setting status to disabled', async () => {
    mockSend.mockResolvedValueOnce({});

    await deleteRule('rule-1');
    expect(mockSend).toHaveBeenCalledOnce();

    const cmd = mockSend.mock.calls[0][0].input;
    expect(cmd.Key).toEqual({ id: 'rule-1' });
    expect(cmd.ExpressionAttributeValues[':status']).toBe('disabled');
  });
});

// ─── findMatchingRules ──────────────────────────────────────

describe('findMatchingRules', () => {
  it('returns matched rules with mapped inputs', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          id: 'rule-1',
          eventType: 'invoice.created',
          conditions: null,
          actionConfig: { fieldMapping: { id: '$.resourceId' } },
          targetWorkflowId: 'wf-1',
        },
      ],
    });

    const results = await findMatchingRules('org-1', 'xero', 'invoice.created', {
      resourceId: 'inv-123',
    });

    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(true);
    expect(results[0].mappedInputs).toEqual({ id: 'inv-123' });
  });

  it('excludes rules with non-matching event types', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { id: 'rule-1', eventType: 'contact.created', conditions: null, actionConfig: {} },
      ],
    });

    const results = await findMatchingRules('org-1', 'xero', 'invoice.created', {});
    expect(results).toHaveLength(0);
  });

  it('supports wildcard event types', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { id: 'rule-1', eventType: 'invoice.*', conditions: null, actionConfig: {} },
      ],
    });

    const results = await findMatchingRules('org-1', 'xero', 'invoice.updated', {});
    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(true);
  });

  it('returns unmatched rules with reason when conditions fail', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          id: 'rule-1',
          eventType: 'invoice.created',
          conditions: {
            operator: 'and',
            rules: [{ field: 'amount', operator: 'gt', value: 1000 }],
          },
          actionConfig: {},
        },
      ],
    });

    const results = await findMatchingRules('org-1', 'xero', 'invoice.created', { amount: 50 });
    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(false);
    expect(results[0].reason).toBeDefined();
  });

  it('returns empty results when no rules exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const results = await findMatchingRules('org-1', 'xero', 'invoice.created', {});
    expect(results).toEqual([]);
  });
});

// ─── processEvent ───────────────────────────────────────────

describe('processEvent', () => {
  const baseParams = {
    orgId: 'org-1',
    connectionId: 'conn-1',
    platform: 'xero' as const,
    eventInfo: {
      eventType: 'invoice.created',
      eventLabel: 'Invoice Created',
      recordId: 'inv-1',
      summary: 'Invoice Created — inv-1',
      rawEventType: 'INVOICE.CREATE',
      metadata: {},
    },
    rawPayload: { resourceId: 'inv-1', amount: 500 },
    webhookEventId: 'wh-1',
  };

  it('creates inbound pipeline entry and returns result when no rules match', async () => {
    // 1st call: PutCommand for inbound entry
    mockSend.mockResolvedValueOnce({});
    // 2nd call: QueryCommand for findMatchingRules
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await processEvent(baseParams);

    expect(result.eventType).toBe('invoice.created');
    expect(result.matchedRules).toBe(0);
    expect(result.launchedWorkflows).toBe(0);
    expect(result.pipelineEntries).toHaveLength(1);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('queues workflow launch for matched rules', async () => {
    // 1st: PutCommand for inbound entry
    mockSend.mockResolvedValueOnce({});
    // 2nd: QueryCommand for findMatchingRules
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          id: 'rule-1',
          name: 'Test Rule',
          eventType: 'invoice.created',
          conditions: null,
          targetWorkflowId: 'wf-1',
          actionConfig: {},
        },
      ],
    });
    // 3rd: PutCommand for rule_match pipeline entry
    mockSend.mockResolvedValueOnce({});
    // 4th: UpdateCommand for rule stats
    mockSend.mockResolvedValueOnce({});

    mockSendMessage.mockResolvedValueOnce({});

    const result = await processEvent(baseParams);

    expect(result.matchedRules).toBe(1);
    expect(result.launchedWorkflows).toBe(1);
    expect(result.pipelineEntries).toHaveLength(2);

    // Verify SQS message sent
    expect(mockSendMessage).toHaveBeenCalledWith(
      'wf-launcher',
      expect.objectContaining({
        ruleId: 'rule-1',
        workflowId: 'wf-1',
        orgId: 'org-1',
      }),
    );
  });

  it('handles multiple matching rules', async () => {
    mockSend.mockResolvedValueOnce({}); // inbound entry
    mockSend.mockResolvedValueOnce({
      Items: [
        { id: 'r1', name: 'Rule 1', eventType: 'invoice.created', conditions: null, targetWorkflowId: 'wf-1', actionConfig: {} },
        { id: 'r2', name: 'Rule 2', eventType: 'invoice.*', conditions: null, targetWorkflowId: 'wf-2', actionConfig: {} },
      ],
    });
    mockSend.mockResolvedValueOnce({}); // pipeline entry 1
    mockSend.mockResolvedValueOnce({}); // rule stats 1
    mockSend.mockResolvedValueOnce({}); // pipeline entry 2
    mockSend.mockResolvedValueOnce({}); // rule stats 2
    mockSendMessage.mockResolvedValue({});

    const result = await processEvent(baseParams);

    expect(result.matchedRules).toBe(2);
    expect(result.launchedWorkflows).toBe(2);
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });
});
