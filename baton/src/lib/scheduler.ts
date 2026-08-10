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

let batchDispatchInFlight = false;
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

  // Every 30 seconds: sync running instance statuses from Maestro. The
  // in-flight guard stops passes from stacking when one pass outlives the
  // 30s interval (large table, many Maestro round-trips).
  cron.schedule('*/30 * * * * *', async () => {
    if (isRateLimited() || instanceSyncInFlight) return;
    instanceSyncInFlight = true;
    try {
      await syncRunningInstanceStatuses();
    } catch (err) {
      if (!handleRateLimitError(err)) {
        logError('Instance status sync failed', err);
      }
    } finally {
      instanceSyncInFlight = false;
    }
  });

  // Every 30 seconds: release queued Bulk Upload rows for batch runs whose
  // nextReleaseAt is due. Logic lives in batch.service.dispatchDueBatchRuns.
  // In-flight guard: with runs executing concurrently a pass can outlive the
  // interval; per-row conditional writes make overlap safe but stacking
  // passes would only add contention.
  cron.schedule('*/30 * * * * *', async () => {
    if (batchDispatchInFlight) return;
    batchDispatchInFlight = true;
    try {
      await dispatchDueBatchRuns();
    } catch (err) {
      logError('Bulk Upload dispatcher failed', err);
    } finally {
      batchDispatchInFlight = false;
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

let instanceSyncInFlight = false;

/** Scan cursor persisted across passes — each pass walks at most
 *  MAX_SYNC_SCAN_PAGES pages from where the previous pass stopped, wrapping
 *  at the table end. Bounded per tick, full coverage across ticks. */
let syncScanCursor: Record<string, unknown> | undefined;
const MAX_SYNC_SCAN_PAGES = 5;

/** Per-instance backoff for the direct-fetch fallback, so an instance that is
 *  permanently missing upstream (deleted in Maestro, stale id) costs one API
 *  call every FALLBACK_RETRY_MS, not one per 30s tick forever. */
const instanceFallbackBackoff = new Map<string, number>();
const FALLBACK_RETRY_MS = 10 * 60_000;
const MAX_FALLBACKS_PER_PASS = 25;

async function syncRunningInstanceStatuses(): Promise<void> {
  const docClient = getDocClient();

  // Find running instances. The old capped single-page Scan (Limit applies to
  // items evaluated BEFORE the filter, restarting from the table start each
  // tick) permanently hid instances past the cap once the table outgrew it.
  // The cursor walk covers the whole table across passes without unbounded
  // per-tick cost.
  const running: WorkflowInstance[] = [];
  let pages = 0;
  do {
    const result: any = await docClient.send(new ScanCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      FilterExpression: '#st = :running',
      ExpressionAttributeValues: { ':running': 'running' },
      ExpressionAttributeNames: { '#st': 'status' },
      ExclusiveStartKey: syncScanCursor,
    }));
    running.push(...((result.Items as WorkflowInstance[]) || []));
    syncScanCursor = result.LastEvaluatedKey; // undefined = wrapped to the start
    pages++;
  } while (syncScanCursor && pages < MAX_SYNC_SCAN_PAGES);
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
  let fallbacksThisPass = 0;

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

      // Resolve a valid Docusign connection — fall back to org-level lookup if stored ID is stale
      let connectionId = workflow.connectionId;
      if (connectionId) {
        const conn = await connectionService.getConnection(connectionId);
        if (!conn) {
          logDebug('Workflow connectionId not found — falling back to org Docusign connection', { workflowId, connectionId });
          connectionId = undefined;
        }
      }
      if (!connectionId) {
        const conn = await connectionService.getConnectionByOrgAndPlatform(workflow.orgId, 'docusign');
        if (!conn) {
          logDebug('No Docusign connection for org — skipping workflow sync', { workflowId, orgId: workflow.orgId });
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
          let maestroInstance = maestroById.get(instance.maestroInstanceId!);
          if (!maestroInstance) {
            // The instances list endpoint is not paginated on the Maestro
            // side, so at batch scale our instance can fall off the first
            // page and would otherwise stay 'running' in Baton forever.
            // Fall back to a direct single-instance fetch - backed off per
            // instance and capped per pass so permanently-missing instances
            // don't burn API quota every tick.
            const nextTryAt = instanceFallbackBackoff.get(instance.id) ?? 0;
            if (Date.now() < nextTryAt || fallbacksThisPass >= MAX_FALLBACKS_PER_PASS) {
              continue;
            }
            fallbacksThisPass++;
            try {
              maestroInstance = await maestroService.getInstance(
                connectionId,
                workflow.maestroWorkflowId,
                instance.maestroInstanceId!,
              );
              instanceFallbackBackoff.delete(instance.id);
            } catch (fetchErr: any) {
              if (String(fetchErr?.message || '').includes('HOURLY_APIINVOCATION_LIMIT_EXCEEDED')) throw fetchErr;
              if (instanceFallbackBackoff.size > 10_000) instanceFallbackBackoff.clear();
              instanceFallbackBackoff.set(instance.id, Date.now() + FALLBACK_RETRY_MS);
              logDebug('Workflow Builder instance not found in list response or by direct fetch', {
                instanceId: instance.id,
                maestroInstanceId: instance.maestroInstanceId,
                error: fetchErr?.message,
              });
              continue;
            }
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

          // Send notification directly for terminal states. Batch rows are
          // deliberately excluded: per-row notifications would fire once per
          // file row, and 'batch' is a sentinel, not a userId - fanning out
          // with it persisted invisible notifications addressed to 'batch'.
          // Batch-level notification events are a spec-deferred feature.
          if (instance.launchedBy && instance.launchedBy !== 'batch' && workflow) {
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
              // Per-instance failures ROLL UP per automation (or workflow) per
              // hour: "5 instances failed in X" instead of five entries.
              if (maestroInstance.status === 'failed') {
                payload.collapseKey = `workflow_failed:${instance.triggerRuleId ?? instance.workflowId}:${new Date().toISOString().slice(0, 13)}`;
              }
              await sendNotification(payload);
            }
          }
        } catch (err: any) {
          // Rate-limit errors propagate to the workflow-level catch, which
          // sets the backoff and stops the whole sync pass.
          if (String(err?.message || '').includes('HOURLY_APIINVOCATION_LIMIT_EXCEEDED')) throw err;
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

