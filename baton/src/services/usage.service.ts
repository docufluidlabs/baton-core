/**
 * Usage Service — Baton
 *
 * Tracks and enforces execution quotas per organization.
 * Uses atomic DynamoDB updates for safe concurrency.
 */

import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { PLAN_INFO } from './stripe.service';
import { OrgPlan } from '../lib/types';
import { logInfo, logError } from '../lib/logger';
import { getOrgAdmin } from './user.service';
import {
  sendNotification,
  executionQuotaWarningNotification,
  overageStartedNotification,
} from './notification.service';

function includedRelaysFor(plan?: string): number {
  return PLAN_INFO[(plan as OrgPlan) || 'free_demo']?.includedRelays ?? Infinity;
}

// ─── Types ──────────────────────────────────────────────────

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
}

export class ExecutionLimitError extends Error {
  public readonly orgId: string;
  public readonly used: number;
  public readonly limit: number;

  constructor(orgId: string, used: number, limit: number) {
    super(`Organization ${orgId} has reached its execution limit (${used}/${limit})`);
    this.name = 'ExecutionLimitError';
    this.orgId = orgId;
    this.used = used;
    this.limit = limit;
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Check if an org has remaining execution quota.
 */
export async function checkExecutionQuota(orgId: string): Promise<QuotaResult> {
  const docClient = getDocClient();

  const result = await docClient.send(new GetCommand({
    TableName: TableNames.ORGANIZATIONS,
    Key: { id: orgId },
    ProjectionExpression: '#p, executionsUsed',
    ExpressionAttributeNames: { '#p': 'plan' },
  }));

  const org = result.Item;

  const used = org?.executionsUsed || 0;
  const limit = includedRelaysFor(org?.plan);

  return {
    allowed: limit === Infinity || used < limit,
    used,
    limit,
  };
}

/**
 * Atomically increment the execution count for an org.
 */
export async function incrementExecutionCount(orgId: string): Promise<void> {
  const docClient = getDocClient();

  const result = await docClient.send(new UpdateCommand({
    TableName: TableNames.ORGANIZATIONS,
    Key: { id: orgId },
    UpdateExpression: 'ADD executionsUsed :inc',
    ExpressionAttributeValues: { ':inc': 1 },
    ReturnValues: 'ALL_NEW',
  }));

  const org = result.Attributes;
  if (!org) return;
  const used = org.executionsUsed || 0;
  const included = includedRelaysFor(org.plan);
  if (!Number.isFinite(included)) return;   // exempt plans — no warnings or overage

  // 80% warning — once per cycle
  if (used >= Math.floor(included * 0.8) && used < included && !org.quotaWarningShownAt) {
    try {
      await docClient.send(new UpdateCommand({
        TableName: TableNames.ORGANIZATIONS,
        Key: { id: orgId },
        UpdateExpression: 'SET quotaWarningShownAt = :now',
        ConditionExpression: 'attribute_not_exists(quotaWarningShownAt)',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      }));
      const adminId = await getOrgAdmin(orgId);
      if (adminId) {
        await sendNotification(executionQuotaWarningNotification(orgId, adminId, used, included));
      }
    } catch (err: any) {
      if (err.name !== 'ConditionalCheckFailedException') {
        logError('Failed to send quota warning', err);
      }
    }
  }

  // Overage-started notification — fires once when the cycle first crosses `included`.
  // Reset alongside executionsUsed in the daily 2am cycle-rollover job (scheduler.ts).
  if (used > included && !org.overageStartedShownAt && org.overageEnabled) {
    try {
      await docClient.send(new UpdateCommand({
        TableName: TableNames.ORGANIZATIONS,
        Key: { id: orgId },
        UpdateExpression: 'SET overageStartedShownAt = :now',
        ConditionExpression: 'attribute_not_exists(overageStartedShownAt)',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      }));
      const adminId = await getOrgAdmin(orgId);
      if (adminId) {
        await sendNotification(
          overageStartedNotification(orgId, adminId, included, org.overageRateCents || 0),
        );
      }
    } catch (err: any) {
      if (err.name !== 'ConditionalCheckFailedException') {
        logError('Failed to send overage-started notification', err);
      }
    }
  }
}

/**
 * Atomically increment the successful execution count for an org.
 */
export async function incrementSuccessCount(orgId: string): Promise<void> {
  const docClient = getDocClient();

  await docClient.send(new UpdateCommand({
    TableName: TableNames.ORGANIZATIONS,
    Key: { id: orgId },
    UpdateExpression: 'ADD successfulExecutions :inc',
    ExpressionAttributeValues: { ':inc': 1 },
  }));
}

/**
 * Mark an instance as completion-counted and increment org success count.
 * Uses a conditional update to ensure idempotency — only counts once per instance.
 */
export async function countCompletionIfNeeded(instanceId: string, orgId: string): Promise<boolean> {
  const docClient = getDocClient();

  try {
    await docClient.send(new UpdateCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: instanceId },
      UpdateExpression: 'SET completionCounted = :true',
      ConditionExpression: 'attribute_not_exists(completionCounted) OR completionCounted = :false',
      ExpressionAttributeValues: { ':true': true, ':false': false },
    }));

    // Flag was set — this is the first time, so increment
    await incrementSuccessCount(orgId);
    logInfo('Successful execution counted', { instanceId, orgId });
    return true;
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Already counted — skip
      return false;
    }
    throw err;
  }
}

/**
 * Reset execution count to zero (called on billing cycle rollover).
 */
export async function resetExecutionCount(orgId: string): Promise<void> {
  const docClient = getDocClient();
  const now = new Date().toISOString();

  await docClient.send(new UpdateCommand({
    TableName: TableNames.ORGANIZATIONS,
    Key: { id: orgId },
    UpdateExpression:
      'SET executionsUsed = :zero, successfulExecutions = :zero, billingCycleStart = :now, updatedAt = :now ' +
      'REMOVE quotaWarningShownAt, overageStartedShownAt, hardCapShownAt',
    ExpressionAttributeValues: { ':zero': 0, ':now': now },
  }));

  logInfo('Execution count reset for org', { orgId });
}
