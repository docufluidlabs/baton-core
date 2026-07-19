/**
 * Rule Engine Service — Baton
 * 
 * NEW — no equivalent in existing extension apps.
 * 
 * Responsibilities:
 * - Match inbound webhook events to active automation rules
 * - Evaluate conditions (field comparisons against event payload)
 * - Map event data to Maestro workflow trigger_inputs
 * - Create trigger pipeline entries for tracking
 * 
 * Hot path: every inbound webhook triggers rule matching.
 * Optimized for the query: 
 *   SELECT * FROM automation_rules 
 *   WHERE orgId=? AND sourcePlatform=? AND eventType=? AND status='active'
 */

import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logInfo, logError, logWarn, logDebug } from '../lib/logger';
import {
  AutomationRule,
  TriggerPipelineEntry,
  Platform,
  PipelineStatus,
  WorkflowLaunchJob,
  QueuedWebhook,
} from '../lib/types';
import { ExtractedEventInfo } from './connectors';
import { sendMessage, QueueNames } from '../queue/sqs-client';

// ─── Types ───────────────────────────────────────────────────

export interface RuleMatchResult {
  rule: AutomationRule;
  matched: boolean;
  reason?: string;
  mappedInputs?: Record<string, any>;
  queued?: boolean; // true when rule is paused — webhook should be queued not launched
}

export interface ProcessEventResult {
  eventType: string;
  matchedRules: number;
  launchedWorkflows: number;
  queuedWebhooks: number;
  pipelineEntries: string[];
}

// ─── Rule CRUD ───────────────────────────────────────────────

export async function createRule(params: {
  orgId: string;
  name: string;
  connectionId?: string;
  appId?: string;
  appSlug?: string;
  sourcePlatform: Platform;
  eventType: string;
  eventLabel: string;
  conditions?: Record<string, any>;
  conditionsDisplay?: string;
  targetWorkflowId: string;
  actionConfig?: Record<string, any>;
  retryMaxAttempts?: number;
  retryStrategy?: 'linear' | 'exponential';
  retryIntervalSec?: number;
  webhookKey?: string;
  createdBy?: string;
}): Promise<AutomationRule> {
  const docClient = getDocClient();
  const now = new Date().toISOString();
  const id = uuidv4();
  const webhookKey = params.webhookKey || crypto.randomBytes(32).toString('hex');

  const rule: AutomationRule = {
    id,
    orgId: params.orgId,
    name: params.name,
    connectionId: params.connectionId,
    appId: params.appId,
    appSlug: params.appSlug as AutomationRule['appSlug'],
    sourcePlatform: params.sourcePlatform,
    eventType: params.eventType,
    eventLabel: params.eventLabel,
    conditions: params.conditions,
    conditionsDisplay: params.conditionsDisplay,
    actionType: 'launch_workflow',
    targetWorkflowId: params.targetWorkflowId,
    actionConfig: params.actionConfig || {},
    webhookKey,
    status: 'active',
    retryMaxAttempts: params.retryMaxAttempts ?? 3,
    retryStrategy: params.retryStrategy ?? 'exponential',
    retryIntervalSec: params.retryIntervalSec ?? 60,
    timesTriggered: 0,
    lastTriggeredAt: undefined,
    successRate: 100,
    failureCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy,
  };

  await docClient.send(new PutCommand({
    TableName: TableNames.AUTOMATION_RULES,
    Item: rule,
  }));

  logInfo('Automation rule created', { id, orgId: params.orgId, eventType: params.eventType });
  return rule;
}

export async function getRule(id: string): Promise<AutomationRule | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.AUTOMATION_RULES,
    Key: { id },
  }));
  return (result.Item as AutomationRule) || null;
}

export async function getRulesByOrg(orgId: string): Promise<AutomationRule[]> {
  const docClient = getDocClient();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.AUTOMATION_RULES,
    IndexName: 'orgId-index',
    KeyConditionExpression: 'orgId = :orgId',
    ExpressionAttributeValues: { ':orgId': orgId },
  }));
  return (result.Items as AutomationRule[]) || [];
}

export async function updateRuleStatus(id: string, status: 'active' | 'paused' | 'error' | 'disabled'): Promise<void> {
  const docClient = getDocClient();
  await docClient.send(new UpdateCommand({
    TableName: TableNames.AUTOMATION_RULES,
    Key: { id },
    UpdateExpression: 'SET #st = :status, updatedAt = :now',
    ExpressionAttributeValues: { ':status': status, ':now': new Date().toISOString() },
    ExpressionAttributeNames: { '#st': 'status' },
  }));
}

export async function deleteRule(id: string): Promise<void> {
  const docClient = getDocClient();
  await docClient.send(new UpdateCommand({
    TableName: TableNames.AUTOMATION_RULES,
    Key: { id },
    UpdateExpression: 'SET #st = :status, updatedAt = :now',
    ExpressionAttributeValues: { ':status': 'disabled', ':now': new Date().toISOString() },
    ExpressionAttributeNames: { '#st': 'status' },
  }));
  logInfo('Automation rule soft-deleted', { id });
}

// ─── Rule Matching (Hot Path) ────────────────────────────────

/**
 * Find active rules that match the given event.
 * This is THE critical path — called on every webhook.
 */
export async function findMatchingRules(
  orgId: string,
  platform: Platform,
  eventType: string,
  payload: Record<string, any>,
  /** connectionId or appId — used to scope rules to a specific installation */
  sourceId?: string,
): Promise<RuleMatchResult[]> {
  const docClient = getDocClient();

  // Query rules by orgId, filter by platform + active/paused status.
  // Paused rules are included so webhooks can be queued (non-lossy pause).
  // connectionId is passed as the installed app's id when the event comes
  // from a catalog app — rules match either via connectionId OR appId field.
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.AUTOMATION_RULES,
    IndexName: 'orgId-index',
    KeyConditionExpression: 'orgId = :orgId',
    FilterExpression: 'sourcePlatform = :platform AND (#st = :active OR #st = :paused)',
    ExpressionAttributeValues: {
      ':orgId': orgId,
      ':platform': platform,
      ':active': 'active',
      ':paused': 'paused',
    },
    ExpressionAttributeNames: { '#st': 'status' },
  }));

  const rules = (result.Items as AutomationRule[]) || [];

  logDebug('Rule matching', { orgId, platform, eventType, candidateRules: rules.length });

  const results: RuleMatchResult[] = [];

  for (const rule of rules) {
    // Check event type match (supports wildcards like "vendor.*")
    if (!matchEventType(rule.eventType, eventType)) {
      continue;
    }

    // If a sourceId is provided, the rule must be associated with the same
    // connection or app — prevents rules from one app installation triggering
    // on webhooks from a different installation in the same org.
    if (sourceId) {
      const ruleSource = rule.connectionId || rule.appId;
      if (ruleSource && ruleSource !== sourceId) {
        continue;
      }
    }

    // Evaluate conditions
    const conditionResult = evaluateConditions(rule.conditions, payload);

    if (conditionResult.matched) {
      // Map event data to workflow trigger inputs
      const mappedInputs = mapFieldsToTriggerInputs(rule.actionConfig, payload);

      results.push({
        rule,
        matched: true,
        mappedInputs,
        queued: rule.status === 'paused',
      });
    } else {
      results.push({
        rule,
        matched: false,
        reason: conditionResult.reason,
      });
    }
  }

  logDebug('Rule matching complete', {
    orgId,
    platform,
    eventType,
    total: rules.length,
    matched: results.filter((r) => r.matched).length,
  });

  return results;
}

// ─── Process Event (Full Pipeline) ──────────────────────────

/**
 * Full event processing pipeline:
 * 1. Find matching rules
 * 2. For each match: create pipeline entry + queue workflow launch
 * 3. Create inbound pipeline entry for audit
 */
export async function processEvent(params: {
  orgId: string;
  connectionId: string; // acts as sourceId for both OAuth connections and installed apps
  platform: Platform;
  eventInfo: ExtractedEventInfo;
  rawPayload: Record<string, any>;
  webhookEventId: string;
  requestId?: string;
  /** When set (per-rule webhook endpoint), only this rule is evaluated — prevents
   *  other rules from being triggered by a webhook destined for a specific rule. */
  ruleId?: string;
  /** End-to-end correlation id from SF Apex (X-Baton-Dispatch-Id header). */
  sfDispatchId?: string;
}): Promise<ProcessEventResult> {
  const { orgId, connectionId, platform, eventInfo, rawPayload, webhookEventId, requestId, ruleId, sfDispatchId } = params;
  const now = new Date().toISOString();
  const docClient = getDocClient();

  // 1. Create inbound pipeline entry
  const inboundEntry: TriggerPipelineEntry = {
    id: uuidv4(),
    orgId,
    sourcePlatform: platform,
    eventType: 'inbound',
    eventSummary: eventInfo.summary,
    rawPayload,
    actionDescription: `Received ${eventInfo.eventLabel} from ${platform}`,
    status: 'completed',
    attributedTo: eventInfo.actingUserEmail,
    triggeredAt: now,
    completedAt: now,
    durationMs: 0,
    attemptNumber: 1,
    userActionable: false,
    webhookEventId,
  };

  await docClient.send(new PutCommand({
    TableName: TableNames.TRIGGER_PIPELINE,
    Item: inboundEntry,
  }));

  // 2. Find matching rules — pass connectionId as sourceId to scope to this installation.
  // If ruleId is provided (per-rule webhook), only evaluate that specific rule.
  let matchResults = await findMatchingRules(orgId, platform, eventInfo.eventType, rawPayload, connectionId);
  if (ruleId) {
    matchResults = matchResults.filter((r) => r.rule.id === ruleId);
  }
  const matched = matchResults.filter((r) => r.matched);
  const activeMatches = matched.filter((r) => !r.queued);
  const pausedMatches = matched.filter((r) => r.queued);

  logInfo('Event processed', {
    orgId,
    platform,
    eventType: eventInfo.eventType,
    matchedRules: matched.length,
    launchingNow: activeMatches.length,
    queuing: pausedMatches.length,
    webhookEventId,
  });

  const pipelineEntries: string[] = [inboundEntry.id];
  let launchedWorkflows = 0;
  let queuedWebhooks = 0;

  // 3a. For each PAUSED matching rule, store webhook in queue
  for (const match of pausedMatches) {
    await storeQueuedWebhook({
      ruleId: match.rule.id,
      orgId,
      platform,
      eventType: eventInfo.eventType,
      eventSummary: eventInfo.summary,
      rawPayload,
      mappedInputs: match.mappedInputs,
      webhookEventId,
    });
    queuedWebhooks++;
    logInfo('Webhook queued for paused rule', { ruleId: match.rule.id });
  }

  // 3b. For each ACTIVE matching rule, create pipeline entry + queue workflow launch
  for (const match of activeMatches) {
    const rule = match.rule;

    // Create rule_match pipeline entry
    const rawPayloadJson = JSON.stringify(rawPayload);
    const safeRawPayload = rawPayloadJson.length > 50_000
      ? { _truncated: true, size: rawPayloadJson.length, preview: rawPayloadJson.slice(0, 500) }
      : rawPayload;

    // Count existing rule_match entries for this rule to assign actionNumber
    const countResult = await docClient.send(new QueryCommand({
      TableName: TableNames.TRIGGER_PIPELINE,
      IndexName: 'ruleId-triggeredAt-index',
      KeyConditionExpression: 'ruleId = :ruleId',
      ExpressionAttributeValues: { ':ruleId': rule.id },
      Select: 'COUNT',
    }));
    const actionNumber = (countResult.Count ?? 0) + 1;

    const ruleMatchEntry: TriggerPipelineEntry = {
      id: uuidv4(),
      orgId,
      ruleId: rule.id,
      sourcePlatform: platform,
      eventType: 'rule_match',
      eventSummary: `Automation "${rule.name}" matched: ${eventInfo.eventLabel}`,
      actionDescription: `Launching workflow for automation "${rule.name}"`,
      status: 'pending',
      attributedTo: eventInfo.actingUserEmail,
      triggeredAt: now,
      attemptNumber: 1,
      userActionable: false,
      rawPayload: safeRawPayload,
      webhookEventId,
      actionNumber,
    };

    await docClient.send(new PutCommand({
      TableName: TableNames.TRIGGER_PIPELINE,
      Item: ruleMatchEntry,
    }));

    pipelineEntries.push(ruleMatchEntry.id);

    // Queue workflow launch
    if (rule.targetWorkflowId) {
      const instanceName = generateInstanceName(rule.name, eventInfo);

      const launchJob: WorkflowLaunchJob = {
        ruleId: rule.id,
        ruleName: rule.name,
        actionNumber,
        sourcePlatform: rule.sourcePlatform,
        pipelineEntryId: ruleMatchEntry.id,
        workflowId: rule.targetWorkflowId,
        orgId,
        inputData: match.mappedInputs || {},
        instanceName,
        requestId,
        sfDispatchId,
      };

      await sendMessage(QueueNames.WORKFLOW_LAUNCHER, launchJob);
      launchedWorkflows++;

      logInfo('Workflow launch queued', {
        ruleId: rule.id,
        workflowId: rule.targetWorkflowId,
        pipelineEntryId: ruleMatchEntry.id,
      });
    }

    // Update rule stats
    await updateRuleStats(rule.id);
  }

  return {
    eventType: eventInfo.eventType,
    matchedRules: matched.length,
    launchedWorkflows,
    queuedWebhooks,
    pipelineEntries,
  };
}

// ─── Queued Webhook Helpers ──────────────────────────────────

export async function storeQueuedWebhook(params: {
  ruleId: string;
  orgId: string;
  platform: Platform;
  eventType: string;
  eventSummary: string;
  rawPayload: Record<string, any>;
  mappedInputs?: Record<string, any>;
  webhookEventId?: string;
}): Promise<string> {
  const docClient = getDocClient();
  const id = uuidv4();
  const item: QueuedWebhook = {
    id,
    ...params,
    queuedAt: new Date().toISOString(),
    status: 'queued',
  };
  await docClient.send(new PutCommand({ TableName: TableNames.QUEUED_WEBHOOKS, Item: item }));
  return id;
}

export async function getQueuedWebhooks(ruleId: string): Promise<QueuedWebhook[]> {
  const docClient = getDocClient();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.QUEUED_WEBHOOKS,
    IndexName: 'ruleId-queuedAt-index',
    KeyConditionExpression: 'ruleId = :ruleId',
    FilterExpression: '#st = :queued',
    ExpressionAttributeValues: { ':ruleId': ruleId, ':queued': 'queued' },
    ExpressionAttributeNames: { '#st': 'status' },
    ScanIndexForward: true,
  }));
  return (result.Items as QueuedWebhook[]) || [];
}

export async function releaseQueuedWebhook(
  item: QueuedWebhook,
  rule: AutomationRule,
  requestId?: string,
): Promise<void> {
  const docClient = getDocClient();
  const now = new Date().toISOString();

  await docClient.send(new UpdateCommand({
    TableName: TableNames.QUEUED_WEBHOOKS,
    Key: { id: item.id },
    UpdateExpression: 'SET #st = :released, releasedAt = :now',
    ExpressionAttributeValues: { ':released': 'released', ':now': now },
    ExpressionAttributeNames: { '#st': 'status' },
  }));

  if (!rule.targetWorkflowId) return;

  const countResult = await docClient.send(new QueryCommand({
    TableName: TableNames.TRIGGER_PIPELINE,
    IndexName: 'ruleId-triggeredAt-index',
    KeyConditionExpression: 'ruleId = :ruleId',
    ExpressionAttributeValues: { ':ruleId': rule.id },
    Select: 'COUNT',
  }));
  const actionNumber = (countResult.Count ?? 0) + 1;

  const pipelineEntry: TriggerPipelineEntry = {
    id: uuidv4(),
    orgId: rule.orgId,
    ruleId: rule.id,
    sourcePlatform: item.platform,
    eventType: 'rule_match',
    eventSummary: `[Queue] ${item.eventSummary}`,
    actionDescription: `Launching workflow for automation "${rule.name}" (from queue)`,
    status: 'pending',
    triggeredAt: now,
    attemptNumber: 1,
    userActionable: false,
    actionNumber,
    webhookEventId: item.webhookEventId,
  };

  await docClient.send(new PutCommand({ TableName: TableNames.TRIGGER_PIPELINE, Item: pipelineEntry }));

  const launchJob: WorkflowLaunchJob = {
    ruleId: rule.id,
    ruleName: rule.name,
    actionNumber,
    sourcePlatform: rule.sourcePlatform,
    pipelineEntryId: pipelineEntry.id,
    workflowId: rule.targetWorkflowId,
    orgId: rule.orgId,
    inputData: item.mappedInputs || {},
    instanceName: `${rule.name} #${actionNumber}`,
    requestId,
  };

  await sendMessage(QueueNames.WORKFLOW_LAUNCHER, launchJob);
  await updateRuleStats(rule.id);
}

export async function cancelQueuedWebhook(itemId: string): Promise<void> {
  const docClient = getDocClient();
  await docClient.send(new UpdateCommand({
    TableName: TableNames.QUEUED_WEBHOOKS,
    Key: { id: itemId },
    UpdateExpression: 'SET #st = :cancelled, cancelledAt = :now',
    ExpressionAttributeValues: { ':cancelled': 'cancelled', ':now': new Date().toISOString() },
    ExpressionAttributeNames: { '#st': 'status' },
  }));
}

// ─── Condition Evaluation ────────────────────────────────────

interface ConditionResult {
  matched: boolean;
  reason?: string;
}

/**
 * Evaluate rule conditions against event payload.
 * 
 * Conditions format:
 * {
 *   "operator": "and" | "or",
 *   "rules": [
 *     { "field": "project_id", "operator": "eq", "value": "12345" },
 *     { "field": "status", "operator": "in", "value": ["active", "pending"] },
 *     { "field": "amount", "operator": "gt", "value": 1000 },
 *   ]
 * }
 */
function evaluateConditions(
  conditions: Record<string, any> | undefined,
  payload: Record<string, any>,
): ConditionResult {
  // No conditions = always match
  if (!conditions || Object.keys(conditions).length === 0) {
    return { matched: true };
  }

  const rules = conditions.rules;
  if (!Array.isArray(rules) || rules.length === 0) {
    return { matched: true };
  }

  const logicalOperator = conditions.operator || 'and';
  const results: boolean[] = [];

  for (const rule of rules) {
    const fieldValue = getNestedValue(payload, rule.field);
    const result = evaluateSingleCondition(fieldValue, rule.operator, rule.value);
    results.push(result);
  }

  if (logicalOperator === 'or') {
    const matched = results.some(Boolean);
    return {
      matched,
      reason: matched ? undefined : `No conditions matched (OR logic)`,
    };
  }

  // Default: AND
  const matched = results.every(Boolean);
  const failedIndex = results.findIndex((r) => !r);
  return {
    matched,
    reason: matched ? undefined : `Condition ${failedIndex + 1} failed: field "${rules[failedIndex]?.field}"`,
  };
}

function evaluateSingleCondition(fieldValue: any, operator: string, targetValue: any): boolean {
  switch (operator) {
    case 'eq':
    case 'equals':
      return String(fieldValue) === String(targetValue);

    case 'neq':
    case 'not_equals':
      return String(fieldValue) !== String(targetValue);

    case 'gt':
    case 'greater_than':
      return Number(fieldValue) > Number(targetValue);

    case 'gte':
    case 'greater_than_or_equal':
      return Number(fieldValue) >= Number(targetValue);

    case 'lt':
    case 'less_than':
      return Number(fieldValue) < Number(targetValue);

    case 'lte':
    case 'less_than_or_equal':
      return Number(fieldValue) <= Number(targetValue);

    case 'in':
    case 'one_of':
      return Array.isArray(targetValue)
        ? targetValue.map(String).includes(String(fieldValue))
        : false;

    case 'not_in':
      return Array.isArray(targetValue)
        ? !targetValue.map(String).includes(String(fieldValue))
        : true;

    case 'contains':
      return String(fieldValue).toLowerCase().includes(String(targetValue).toLowerCase());

    case 'not_contains':
      return !String(fieldValue).toLowerCase().includes(String(targetValue).toLowerCase());

    case 'starts_with':
      return String(fieldValue).toLowerCase().startsWith(String(targetValue).toLowerCase());

    case 'ends_with':
      return String(fieldValue).toLowerCase().endsWith(String(targetValue).toLowerCase());

    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;

    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;

    case 'regex':
      try {
        return new RegExp(String(targetValue)).test(String(fieldValue));
      } catch {
        return false;
      }

    default:
      logWarn('Unknown condition operator', { operator });
      return false;
  }
}

// ─── Field Mapping ───────────────────────────────────────────

/**
 * Map webhook payload fields to Maestro workflow trigger_inputs.
 * 
 * actionConfig.fieldMapping format:
 * {
 *   "fieldMapping": {
 *     "trigger_input_name": "$.payload.field.path",
 *     "project_name": "$.project_id",
 *     "amount": "$.data.total_amount",
 *     "static_field": { "type": "static", "value": "fixed_value" }
 *   }
 * }
 */
function mapFieldsToTriggerInputs(
  actionConfig: Record<string, any> | undefined,
  payload: Record<string, any>,
): Record<string, any> {
  // No manual field mapping configured — pass the raw payload so the
  // workflow-launcher worker can auto-map it against the workflow's
  // triggerInputSchema at launch time.
  if (!actionConfig?.fieldMapping || Object.keys(actionConfig.fieldMapping).length === 0) {
    return { __rawPayload: payload };
  }

  const result: Record<string, any> = {};

  for (const [targetField, sourceSpec] of Object.entries(actionConfig.fieldMapping)) {
    if (typeof sourceSpec === 'string') {
      // Path-based: "$.field.path" or "field.path"
      const path = sourceSpec.startsWith('$.') ? sourceSpec.slice(2) : sourceSpec;
      result[targetField] = getNestedValue(payload, path);
    } else if (typeof sourceSpec === 'object' && sourceSpec !== null) {
      if ((sourceSpec as any).type === 'static') {
        result[targetField] = (sourceSpec as any).value;
      } else if ((sourceSpec as any).type === 'template') {
        result[targetField] = resolveTemplate((sourceSpec as any).template, payload);
      }
    }
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Match event type with wildcard support.
 * "vendor.*" matches "vendor.created", "vendor.updated", etc.
 * "vendor.created" matches exactly "vendor.created"
 * "*" matches everything
 */
function matchEventType(ruleEventType: string, actualEventType: string): boolean {
  if (ruleEventType === '*') return true;
  if (ruleEventType === actualEventType) return true;

  // Wildcard matching
  if (ruleEventType.endsWith('.*')) {
    const prefix = ruleEventType.slice(0, -2);
    return actualEventType.startsWith(prefix + '.');
  }

  return false;
}

/**
 * Get nested value from object using dot notation.
 * e.g. getNestedValue({ a: { b: 1 } }, 'a.b') => 1
 */
function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, obj);
}

/**
 * Resolve a simple template string with payload values.
 * e.g. "Project {{project_id}} — {{name}}" with { project_id: 123, name: "Test" }
 */
function resolveTemplate(template: string, payload: Record<string, any>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
    const value = getNestedValue(payload, path);
    return value !== undefined ? String(value) : '';
  });
}

/**
 * Generate a meaningful instance name for the Maestro workflow.
 */
function generateInstanceName(ruleName: string, eventInfo: ExtractedEventInfo): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const record = eventInfo.recordId ? ` #${eventInfo.recordId}` : '';
  return `${ruleName}${record} — ${timestamp}`;
}

/**
 * Update rule statistics after a trigger.
 */
// @visibleForTesting
export const _testExports = {
  evaluateSingleCondition,
  evaluateConditions,
  matchEventType,
  getNestedValue,
  resolveTemplate,
  mapFieldsToTriggerInputs,
  generateInstanceName,
};

async function updateRuleStats(ruleId: string): Promise<void> {
  const docClient = getDocClient();
  await docClient.send(new UpdateCommand({
    TableName: TableNames.AUTOMATION_RULES,
    Key: { id: ruleId },
    UpdateExpression: 'SET timesTriggered = timesTriggered + :inc, lastTriggeredAt = :now, updatedAt = :now',
    ExpressionAttributeValues: {
      ':inc': 1,
      ':now': new Date().toISOString(),
    },
  }));
}
