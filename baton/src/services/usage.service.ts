/**
 * Usage Service — Baton
 *
 * Tracks execution counts per organization.
 * Uses atomic DynamoDB updates for safe concurrency.
 */

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logInfo } from '../lib/logger';

// ─── Public API ─────────────────────────────────────────────

/**
 * Atomically increment the execution count for an org.
 */
export async function incrementExecutionCount(orgId: string): Promise<void> {
  const docClient = getDocClient();

  await docClient.send(new UpdateCommand({
    TableName: TableNames.ORGANIZATIONS,
    Key: { id: orgId },
    UpdateExpression: 'ADD executionsUsed :inc',
    ExpressionAttributeValues: { ':inc': 1 },
  }));
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
