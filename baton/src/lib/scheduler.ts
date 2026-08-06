/**
 * Scheduled Jobs — Baton
 * Cron-based tasks: proactive token refresh, cleanup, instance status sync
 */
import cron from 'node-cron';
import { QueryCommand, ScanCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { sendMessage, QueueNames } from '../queue/sqs-client';
import { TokenRefreshJob, PlatformConnection, WorkflowInstance, Workflow } from '../lib/types';
import { logInfo, logError, logDebug } from '../lib/logger';
import * as maestroService from '../services/maestro.service';
import * as connectionService from '../services/connection.service';
import { countCompletionIfNeeded } from '../services/usage.service';
import {
  sendNotification,
  workflowCompletedNotification,
  workflowFailedNotification,
} from '../services/notification.service';
import { getOrgAdmins } from '../services/user.service';
import { dispatchDueBatchRuns } from '../services/batch.service';

// ─── Rate limit backoff ──────────────────────────────────────

let rateLimitBackoffUntil = 0;

function isRateLimited(): boolean {
  return Date.now() < rateLimitBackoffUntil;
}

function handleRateLimitError(err: any): boolean {
  const msg = String(err?.message || '');
  if (msg.includes('HOURLY_APIINVOCATION_LIMIT_EXCEEDED')) {
    // Back off for 5 minutes when rate-limited
    rateLimitBackoffUntil = Date.now() + 5 * 60 * 1000;
    logInfo('Workflow Builder API rate limit hit - backing off for 5 minutes');
    return true;
  }
  return false;
}

// ─── Start all scheduled jobs ────────────────────────────────

export function startScheduledJobs(): void {
  logInfo('Starting scheduled jobs...');

  // Every 5 minutes: check for tokens about to expire
  cron.schedule('*/5 * * * *', async () => {
    try {
      await queueExpiringTokenRefreshes();
    } catch (err) {
      logError('Token refresh scheduler failed', err);
    }
  });

  // Every 30 seconds: sync running instance statuses from Maestro
  cron.schedule('*/30 * * * * *', async () => {
    if (isRateLimited()) return;
    try {
      await syncRunningInstanceStatuses();
    } catch (err) {
      if (!handleRateLimitError(err)) {
        logError('Instance status sync failed', err);
      }
    }
  });

  // Every 30 seconds: release queued Bulk Upload rows for batch runs whose
  // nextReleaseAt is due, then reconcile/promote the per-processor run queues.
  // Logic lives in batch.service.dispatchDueBatchRuns.
  cron.schedule('*/30 * * * * *', async () => {
    try {
      await dispatchDueBatchRuns();
    } catch (err) {
      logError('Bulk Upload dispatcher failed', err);
    }
  });

  // Daily at 3am UTC: cleanup old webhook events (>30 days)
  cron.schedule('0 3 * * *', async () => {
    try {
      await cleanupOldWebhookEvents();
    } catch (err) {
      logError('Webhook event cleanup failed', err);
    }
  });

  logInfo('Scheduled jobs started');
}

// ─── Proactive Token Refresh ─────────────────────────────────

async function queueExpiringTokenRefreshes(): Promise<void> {
  const docClient = getDocClient();
  const bufferMs = 15 * 60 * 1000; // 15 minutes before expiry
  const cutoff = new Date(Date.now() + bufferMs).toISOString();

  // Scan all connections (could be optimized with GSI for large scale)
  const result = await docClient.send(new ScanCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    FilterExpression: '#st <> :disconnected AND tokenExpiresAt <= :cutoff AND attribute_exists(tokenExpiresAt)',
    ExpressionAttributeValues: {
      ':disconnected': 'disconnected',
      ':cutoff': cutoff,
    },
    ExpressionAttributeNames: { '#st': 'status' },
  }));

  const connections = (result.Items as PlatformConnection[]) || [];

  if (connections.length === 0) {
    logDebug('No tokens expiring soon');
    return;
  }

  logInfo('Queueing token refresh jobs', { count: connections.length });

  for (const conn of connections) {
    const job: TokenRefreshJob = {
      connectionId: conn.id,
      orgId: conn.orgId,
      platform: conn.platform,
    };
    await sendMessage(QueueNames.TOKEN_REFRESH, job);
  }
}

// ─── Instance Status Sync ────────────────────────────────────

async function syncRunningInstanceStatuses(): Promise<void> {
  const docClient = getDocClient();

  // Find running instances
  const result = await docClient.send(new ScanCommand({
    TableName: TableNames.WORKFLOW_INSTANCES,
    FilterExpression: '#st = :running',
    ExpressionAttributeValues: { ':running': 'running' },
    ExpressionAttributeNames: { '#st': 'status' },
    Limit: 100,
  }));

  const running = (result.Items as WorkflowInstance[]) || [];
  logDebug('Running instances to sync', { count: running.length });

  if (running.length === 0) return;

  // Group running instances by workflowId to batch Maestro API calls
  const byWorkflow = new Map<string, WorkflowInstance[]>();
  for (const instance of running) {
    if (!instance.maestroInstanceId) continue;
    const group = byWorkflow.get(instance.workflowId) || [];
    group.push(instance);
    byWorkflow.set(instance.workflowId, group);
  }

  let synced = 0;
  let errors = 0;

  for (const [workflowId, instances] of byWorkflow) {
    try {
      // Lookup the parent workflow
      const wfResult = await docClient.send(new GetCommand({
        TableName: TableNames.WORKFLOWS,
        Key: { id: workflowId },
      }));
      const workflow = wfResult.Item as Workflow | undefined;

      if (!workflow?.maestroWorkflowId) {
        logDebug('Skipping workflow — missing maestroWorkflowId', { workflowId });
        continue;
      }

      // Resolve a valid DocuSign connection — fall back to org-level lookup if stored ID is stale
      let connectionId = workflow.connectionId;
      if (connectionId) {
        const conn = await connectionService.getConnection(connectionId);
        if (!conn) {
          logDebug('Workflow connectionId not found — falling back to org DocuSign connection', { workflowId, connectionId });
          connectionId = undefined;
        }
      }
      if (!connectionId) {
        const conn = await connectionService.getConnectionByOrgAndPlatform(workflow.orgId, 'docusign');
        if (!conn) {
          logDebug('No DocuSign connection for org — skipping workflow sync', { workflowId, orgId: workflow.orgId });
          continue;
        }
        connectionId = conn.id;
      }

      // Single API call: fetch ALL instances for this workflow (instead of N individual calls)
      const maestroInstances = await maestroService.getInstances(
        connectionId,
        workflow.maestroWorkflowId,
      );

      // Index by Maestro instance ID for fast lookup
      const maestroById = new Map(maestroInstances.map(mi => [mi.id, mi]));

      for (const instance of instances) {
        try {
          const maestroInstance = maestroById.get(instance.maestroInstanceId!);
          if (!maestroInstance) {
            logDebug('Workflow Builder instance not found in list response', {
              instanceId: instance.id,
              maestroInstanceId: instance.maestroInstanceId,
            });
            continue;
          }

          // Only update if the status actually changed
          if (maestroInstance.status === instance.status) continue;

          const now = new Date().toISOString();
          const completedAt = maestroInstance.endDate || now;
          const durationMs = instance.startedAt
            ? new Date(completedAt).getTime() - new Date(instance.startedAt).getTime()
            : undefined;

          const isNewFailure = maestroInstance.status === 'failed' && !instance.countedAsFailed;

          const updateExpression = [
            '#st = :status',
            'currentStep = :step',
            'completedAt = :completedAt',
            ...(durationMs !== undefined ? ['durationMs = :duration'] : []),
            ...(isNewFailure ? ['countedAsFailed = :counted'] : []),
          ];

          const expressionValues: Record<string, any> = {
            ':status': maestroInstance.status,
            ':step': maestroInstance.lastStep || null,
            ':completedAt': completedAt,
            ...(durationMs !== undefined ? { ':duration': durationMs } : {}),
            ...(isNewFailure ? { ':counted': true } : {}),
          };

          // Conditional update: only if status is still 'running' (prevents race condition)
          try {
            await docClient.send(new UpdateCommand({
              TableName: TableNames.WORKFLOW_INSTANCES,
              Key: { id: instance.id },
              UpdateExpression: `SET ${updateExpression.join(', ')}`,
              ConditionExpression: '#st = :oldStatus',
              ExpressionAttributeValues: { ...expressionValues, ':oldStatus': 'running' },
              ExpressionAttributeNames: { '#st': 'status' },
            }));
          } catch (condErr: any) {
            if (condErr.name === 'ConditionalCheckFailedException') {
              logDebug('Instance already updated by another sync cycle', { instanceId: instance.id });
              continue;
            }
            throw condErr;
          }

          synced++;
          logInfo('Instance status synced', {
            instanceId: instance.id,
            oldStatus: instance.status,
            newStatus: maestroInstance.status,
            durationMs,
          });

          // Count successful completion (idempotent)
          if (maestroInstance.status === 'completed') {
            await countCompletionIfNeeded(instance.id, instance.orgId);
          }

          // Decrement failureCount if this instance was previously counted as failed but now succeeded
          if (maestroInstance.status === 'completed' && instance.countedAsFailed && instance.triggerRuleId) {
            try {
              const rule = await docClient.send(new GetCommand({
                TableName: TableNames.AUTOMATION_RULES,
                Key: { id: instance.triggerRuleId },
              }));
              if (rule.Item) {
                const total = rule.Item.timesTriggered || 0;
                const failures = Math.max(0, (rule.Item.failureCount || 0) - 1);
                const successRate = total > 0 ? Math.round(((total - failures) / total) * 100) : 100;
                await docClient.send(new UpdateCommand({
                  TableName: TableNames.AUTOMATION_RULES,
                  Key: { id: instance.triggerRuleId },
                  UpdateExpression: 'SET failureCount = :failures, successRate = :rate, updatedAt = :now',
                  ExpressionAttributeValues: { ':failures': failures, ':rate': successRate, ':now': new Date().toISOString() },
                }));
                logInfo('Decremented automation rule failure count after retry success', { ruleId: instance.triggerRuleId, failures });
              }
            } catch (ruleErr) {
              logError('Failed to decrement automation rule failure count', ruleErr, { ruleId: instance.triggerRuleId });
            }
          }

          // Increment failureCount on the automation rule (only if not already counted for this instance)
          if (isNewFailure && instance.triggerRuleId) {
            try {
              const rule = await docClient.send(new GetCommand({
                TableName: TableNames.AUTOMATION_RULES,
                Key: { id: instance.triggerRuleId },
              }));
              if (rule.Item) {
                const total = rule.Item.timesTriggered || 0;
                const failures = Math.min((rule.Item.failureCount || 0) + 1, total);
                const successRate = total > 0 ? Math.round(((total - failures) / total) * 100) : 0;
                await docClient.send(new UpdateCommand({
                  TableName: TableNames.AUTOMATION_RULES,
                  Key: { id: instance.triggerRuleId },
                  UpdateExpression: 'SET failureCount = failureCount + :inc, successRate = :rate, lastError = :err, updatedAt = :now',
                  ExpressionAttributeValues: {
                    ':inc': 1,
                    ':rate': successRate,
                    ':err': { message: maestroInstance.lastStep || 'Instance failed', at: new Date().toISOString() },
                    ':now': new Date().toISOString(),
                  },
                }));
                logInfo('Updated automation rule failure count', { ruleId: instance.triggerRuleId, failures });
              }
            } catch (ruleErr) {
              logError('Failed to update automation rule failure count', ruleErr, { ruleId: instance.triggerRuleId });
            }
          }

          // Send notification directly for terminal states
          if (instance.launchedBy && workflow) {
            // Automation-launched instances have launchedBy='automation' (a sentinel,
            // not a userId). Fan out to all org admins so the in-app notification
            // reaches a real recipient — otherwise it gets persisted with
            // recipientId='automation' and is invisible to every user.
            const recipients = instance.launchedBy === 'automation'
              ? await getOrgAdmins(instance.orgId)
              : [instance.launchedBy];

            const buildPayload = (recipientId: string) => {
              if (maestroInstance.status === 'completed') {
                return workflowCompletedNotification(
                  instance.orgId, recipientId, workflow.name, instance.id, durationMs,
                  { instanceName: instance.instanceName, maestroInstanceUrl: maestroInstance.instanceUrl },
                );
              }
              if (maestroInstance.status === 'failed') {
                return workflowFailedNotification(
                  instance.orgId, recipientId, workflow.name, instance.id,
                  maestroInstance.lastStep || 'Unknown error',
                  { errorStep: maestroInstance.lastStep, instanceName: instance.instanceName, maestroInstanceUrl: maestroInstance.instanceUrl },
                );
              }
              return null;
            };

            // Slack routes per-org (not per-user), so fire it once with full
            // channel resolution. Subsequent recipients only need in-app + email.
            for (let i = 0; i < recipients.length; i++) {
              const payload = buildPayload(recipients[i]);
              if (!payload) continue;
              if (i > 0) payload.channels = ['in_app', 'email'];
              await sendNotification(payload);
            }
          }
        } catch (err) {
          errors++;
          logError('Failed to sync instance status', err, { instanceId: instance.id });
        }
      }
    } catch (err) {
      if (handleRateLimitError(err)) break; // stop processing remaining workflows
      errors++;
      logError('Failed to sync workflow instances batch', err, { workflowId });
    }
  }

  if (synced > 0 || errors > 0) {
    logInfo('Instance status sync complete', { total: running.length, synced, errors });
  }
}

// ─── Cleanup Old Webhook Events ──────────────────────────────

async function cleanupOldWebhookEvents(): Promise<void> {
  const docClient = getDocClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // This is a simplified version — production would use batch delete
  // `processed` is a DynamoDB reserved word — aliased via ExpressionAttributeNames.
  const result = await docClient.send(new ScanCommand({
    TableName: TableNames.WEBHOOK_EVENTS,
    FilterExpression: 'receivedAt <= :cutoff AND #processed = :true',
    ExpressionAttributeNames: {
      '#processed': 'processed',
    },
    ExpressionAttributeValues: {
      ':cutoff': thirtyDaysAgo,
      ':true': true,
    },
    Limit: 200,
  }));

  const toDelete = result.Items || [];

  if (toDelete.length > 0) {
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');

    // Delete in batches of 25 (DynamoDB limit)
    for (let i = 0; i < toDelete.length; i += 25) {
      const batch = toDelete.slice(i, i + 25);
      await Promise.allSettled(
        batch.map((item: any) =>
          docClient.send(new DeleteCommand({
            TableName: TableNames.WEBHOOK_EVENTS,
            Key: { id: item.id },
          })),
        ),
      );
    }

    logInfo('Cleaned up old webhook events', { count: toDelete.length });
  }
}

