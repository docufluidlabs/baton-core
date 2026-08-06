/**
 * Workflow Launcher Worker — Baton
 *
 * Launches Maestro workflows from the SQS queue.
 * Called after a webhook event matches an automation rule.
 *
 * Retry logic (exponential backoff):
 *   Attempt 1: 2s → 2: 4s → 3: 8s → 4: 5min → 5: 15min → 6: 30min
 *   Instance stays "running" during retries; "failed" only after all 6 exhausted.
 *   If the user manually retries and the instance becomes completed/cancelled,
 *   the automatic retry sequence is abandoned.
 *
 * Flow:
 * 1. Lookup DocuSign connection for org
 * 2. Lookup workflow to get Maestro workflow ID
 * 3. Launch via Maestro API
 * 4. Create workflow_instance record
 * 5. Update trigger_pipeline entry with result
 * 6. Update automation rule stats
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getOrgAdmin, getOrgAdmins } from '../services/user.service';
import { getDocClient, TableNames } from '../db/client';
import { WorkflowLaunchJob, Workflow, WorkflowInstance } from '../lib/types';
import { logError, createLogger } from '../lib/logger';
import * as maestroService from '../services/maestro.service';
import * as connectionService from '../services/connection.service';
import {
  sendNotification,
  workflowFailedNotification,
  rulePausedNotification,
  retryExhaustedNotification,
} from '../services/notification.service';
import * as usageService from '../services/usage.service';
import { getRelayGate, getRelayMeter } from '../lib/billing-hooks';
import { sendMessage, QueueNames } from '../queue/sqs-client';

// ─── Retry Schedule ─────────────────────────────────────────
// Delays in seconds before each retry attempt (1-indexed).
// Total 6 retries: 2s, 4s, 8s, 5min, 15min, 30min.
const RETRY_DELAYS_SEC = [2, 4, 8, 300, 900, 1800];
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_SEC.length;
/** SQS maximum DelaySeconds */
const SQS_MAX_DELAY_SEC = 900;

export async function processWorkflowLaunchJob(job: WorkflowLaunchJob): Promise<void> {
  const { ruleId, ruleName, actionNumber, sourcePlatform, pipelineEntryId, workflowId, orgId, inputData, instanceName, requestId, retry, sfDispatchId, batch } = job;
  const docClient = getDocClient();
  const now = new Date().toISOString();
  const log = createLogger({ worker: 'workflow-launcher', ruleId, workflowId, orgId, requestId, sfDispatchId, batchRunId: batch?.runId, batchRowNumber: batch?.rowNumber });

  // ─── Deferred retry: re-enqueue if not yet time ───────────
  // SQS caps DelaySeconds at 900, so for 30min we use a deferUntil timestamp.
  if (retry?.deferUntil) {
    const remaining = new Date(retry.deferUntil).getTime() - Date.now();
    if (remaining > 2000) { // >2s remaining — re-park
      const delaySec = Math.min(Math.ceil(remaining / 1000), SQS_MAX_DELAY_SEC);
      log.info({ attempt: retry.attempt, delaySec, remaining }, 'Re-parking deferred retry');
      await sendMessage(QueueNames.WORKFLOW_LAUNCHER, job, { delaySeconds: delaySec });
      return; // don't process yet
    }
    // Time has arrived — fall through to actual launch
  }

  // ─── Retry guard: check if instance was already resolved ──
  if (retry?.instanceId) {
    const existing = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: retry.instanceId },
    }));
    const inst = existing.Item as WorkflowInstance | undefined;

    // Instance resolved (user manual retry succeeded, or cancelled)
    if (inst && inst.status !== 'running') {
      log.info({ instanceId: retry.instanceId, status: inst.status }, 'Instance already resolved — abandoning retry');
      return;
    }

    // Different retry sequence (user triggered manual retry → new sequence)
    if (inst && inst.retrySequenceId && inst.retrySequenceId !== retry.sequenceId) {
      log.info({ instanceId: retry.instanceId, expected: retry.sequenceId, actual: inst.retrySequenceId },
        'Retry sequence superseded — abandoning');
      return;
    }
  }

  const isRetryAttempt = !!retry;
  const attemptLabel = isRetryAttempt ? `retry ${retry!.attempt} of ${retry!.maxAttempts}` : 'initial';
  log.info({ instanceName, attempt: attemptLabel }, 'Launching workflow from rule');

  try {
    // 1. Lookup workflow
    const workflowResult = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOWS,
      Key: { id: workflowId },
    }));
    const workflow = workflowResult.Item as Workflow | undefined;

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    if (!workflow.maestroWorkflowId) {
      throw new Error(`Workflow ${workflowId} has no Workflow Builder ID`);
    }

    // 2. Find DocuSign connection for this org
    let connectionId = workflow.connectionId;
    if (connectionId) {
      const conn = await connectionService.getConnection(connectionId);
      if (!conn) {
        log.warn({ connectionId }, 'Workflow connectionId not found — falling back to org DocuSign connection');
        connectionId = undefined;
      }
    }
    if (!connectionId) {
      const docusignConnection = await connectionService.getConnectionByOrgAndPlatform(orgId, 'docusign');
      if (!docusignConnection) {
        throw new Error(`No DocuSign connection found for org ${orgId}`);
      }
      connectionId = docusignConnection.id;
    }

    // 2.5 Relay gate — billing/licensing seam (see lib/billing-hooks.ts).
    // The default gate always allows; the hosted edition injects enforcement.
    // A denial is a policy decision, not an error: we mark the batch row or
    // pipeline entry as skipped and bail without throwing (no SQS retry, no DLQ).
    const gate = await getRelayGate().check(orgId);
    if (!gate.allowed) {
      const reason = gate.reason || 'relay_blocked';
      const userMessage = 'This relay was not launched because your organization has reached its usage limit.';

      if (batch) {
        // Bulk Upload path — no pipeline entry exists; mark the row skipped
        // with the same no-retry semantics.
        await docClient.send(new UpdateCommand({
          TableName: TableNames.BATCH_ROWS,
          Key: { runId: batch.runId, rowNumber: batch.rowNumber },
          UpdateExpression: 'SET #st = :status, errorMessage = :err, completedAt = :now',
          ExpressionAttributeValues: {
            ':status': 'skipped',
            ':err': userMessage,
            ':now': now,
          },
          ExpressionAttributeNames: { '#st': 'status' },
        }));
      } else if (pipelineEntryId) {
        await docClient.send(new UpdateCommand({
          TableName: TableNames.TRIGGER_PIPELINE,
          Key: { id: pipelineEntryId },
          UpdateExpression:
            'SET #st = :status, userMessage = :userMsg, adminMessage = :adminMsg, errorCategory = :cat, userActionable = :act, completedAt = :now',
          ExpressionAttributeValues: {
            ':status': 'skipped',
            ':userMsg': userMessage,
            ':adminMsg': `Relay gate: ${reason}`,
            ':cat': 'quota',
            ':act': true,
            ':now': now,
          },
          ExpressionAttributeNames: { '#st': 'status' },
        }));
      }

      // A retry attempt has a tracking instance in 'running' — resolve it so a
      // gate denial mid-ladder can't strand it as running forever.
      if (retry?.instanceId) {
        try {
          await docClient.send(new UpdateCommand({
            TableName: TableNames.WORKFLOW_INSTANCES,
            Key: { id: retry.instanceId },
            UpdateExpression: 'SET #st = :status, errorMessage = :err, completedAt = :now',
            ConditionExpression: '#st = :running',
            ExpressionAttributeValues: {
              ':status': 'cancelled',
              ':err': `Relay gate: ${reason}`,
              ':running': 'running',
              ':now': now,
            },
            ExpressionAttributeNames: { '#st': 'status' },
          }));
        } catch (err: any) {
          if (err.name !== 'ConditionalCheckFailedException') {
            logError('Failed to resolve tracking instance after relay-gate denial', err);
          }
        }
      }

      log.info({ reason }, 'Relay skipped at relay gate')
      return;
    }

    // 3. Resolve trigger inputs — auto-map if no manual fieldMapping was configured
    const triggerInputs = autoMapFromSchema(inputData, workflow.triggerInputSchema);

    log.info({
      workflowId,
      instanceName,
      hasSchema: !!workflow.triggerInputSchema,
      autoMapped: !!inputData.__rawPayload,
      triggerInputKeys: Object.keys(triggerInputs),
      triggerInputs,
    }, 'Launching workflow with trigger inputs');

    // 4. Launch via Maestro
    const result = await maestroService.launchWorkflow({
      connectionId,
      workflowId: workflow.maestroWorkflowId,
      instanceName,
      triggerInputs,
    });

    // 4. Create or update workflow_instance record
    const resolvedInstanceId = isRetryAttempt && retry?.instanceId ? retry.instanceId : uuidv4();

    if (isRetryAttempt && retry!.instanceId) {
      // Retry succeeded — update existing instance
      await docClient.send(new UpdateCommand({
        TableName: TableNames.WORKFLOW_INSTANCES,
        Key: { id: resolvedInstanceId },
        UpdateExpression: 'SET maestroInstanceId = :mid, #st = :status, errorMessage = :noErr, nextRetryAt = :noRetry, instanceUrl = :url, updatedAt = :now',
        ExpressionAttributeValues: {
          ':mid': result.instanceId,
          ':status': 'running',
          ':noErr': null,
          ':noRetry': null,
          ':url': result.instanceUrl,
          ':now': now,
        },
        ExpressionAttributeNames: { '#st': 'status' },
      }));
    } else {
      // First attempt — create new instance
      const instance: WorkflowInstance = {
        id: resolvedInstanceId,
        orgId,
        workflowId: workflow.id,
        maestroInstanceId: result.instanceId,
        instanceUrl: result.instanceUrl,
        instanceName,
        status: 'running',
        inputData,
        triggerRuleId: ruleId,
        triggerRuleName: ruleName,
        triggerActionNumber: actionNumber,
        sourcePlatform,
        startedAt: now,
        retryCount: 0,
        launchedBy: batch ? 'batch' : 'automation',
        ...(batch ? { batchRunId: batch.runId, batchRowNumber: batch.rowNumber } : {}),
      };

      await docClient.send(new PutCommand({
        TableName: TableNames.WORKFLOW_INSTANCES,
        Item: instance,
      }));
    }

    // 5. Record the launch: batch row for Bulk Upload, pipeline entry otherwise
    if (batch) {
      await docClient.send(new UpdateCommand({
        TableName: TableNames.BATCH_ROWS,
        Key: { runId: batch.runId, rowNumber: batch.rowNumber },
        UpdateExpression: 'SET #st = :status, workflowInstanceId = :wid, maestroInstanceId = :mid, launchedAt = :now',
        ExpressionAttributeValues: {
          ':status': 'launched',
          ':wid': resolvedInstanceId,
          ':mid': result.instanceId,
          ':now': now,
        },
        ExpressionAttributeNames: { '#st': 'status' },
      }));

      // A successful launch resets the run's consecutive-failure streak
      await docClient.send(new UpdateCommand({
        TableName: TableNames.BATCH_RUNS,
        Key: { id: batch.runId },
        UpdateExpression: 'SET consecutiveFailures = :zero',
        ExpressionAttributeValues: { ':zero': 0 },
      }));
    } else if (pipelineEntryId) {
      await docClient.send(new UpdateCommand({
        TableName: TableNames.TRIGGER_PIPELINE,
        Key: { id: pipelineEntryId },
        UpdateExpression: 'SET #st = :status, workflowInstanceId = :instanceId, completedAt = :now, durationMs = :duration',
        ExpressionAttributeValues: {
          ':status': 'completed',
          ':instanceId': resolvedInstanceId,
          ':now': now,
          ':duration': Date.now() - new Date(now).getTime(),
        },
        ExpressionAttributeNames: { '#st': 'status' },
      }));
    }

    // 6. Update workflow stats
    if (!isRetryAttempt) {
      await docClient.send(new UpdateCommand({
        TableName: TableNames.WORKFLOWS,
        Key: { id: workflow.id },
        UpdateExpression: 'SET launchCount = launchCount + :inc, lastLaunchedAt = :now, updatedAt = :now',
        ExpressionAttributeValues: { ':inc': 1, ':now': now },
      }));
    }

    // 7. Update rule success stats (rule-triggered launches only)
    if (ruleId) {
      await updateRuleSuccess(ruleId);
    }

    // 8. Increment org execution count (local read model)
    await usageService.incrementExecutionCount(orgId);

    // 9. Record relay usage via the metering seam — non-fatal. Idempotency
    // key = resolvedInstanceId ensures retries that eventually succeed are
    // recorded exactly once (the default meter is a no-op).
    try {
      await getRelayMeter().record(orgId, 1, resolvedInstanceId);
    } catch (meterErr) {
      logError('Relay meter recording failed (non-fatal)', meterErr);
    }

    log.info({
      maestroInstanceId: result.instanceId,
      instanceUrl: result.instanceUrl,
      attempt: attemptLabel,
    }, 'Workflow launched successfully');
  } catch (error: any) {
    log.error({ err: error, attempt: attemptLabel }, 'Workflow launch failed');

    const errorCategory = categorizeError(error.message || '');
    const isRetryable = errorCategory !== 'auth' && errorCategory !== 'validation';

    // ─── Retry: enqueue next attempt if retryable ───────────
    const currentAttempt = retry?.attempt ?? 0;
    const sequenceId = retry?.sequenceId ?? uuidv4();

    if (isRetryable && currentAttempt < MAX_RETRY_ATTEMPTS) {
      const nextAttempt = currentAttempt + 1;
      const delaySec = RETRY_DELAYS_SEC[nextAttempt - 1]; // 0-indexed array

      // Create instance on first failure so we can track retries
      let instanceId = retry?.instanceId;
      if (!instanceId) {
        instanceId = uuidv4();
        const instance: WorkflowInstance = {
          id: instanceId,
          orgId,
          workflowId,
          instanceName,
          status: 'running',
          inputData,
          triggerRuleId: ruleId,
          triggerActionNumber: actionNumber,
          sourcePlatform,
          startedAt: now,
          retryCount: nextAttempt,
          retrySequenceId: sequenceId,
          retryMaxAttempts: MAX_RETRY_ATTEMPTS,
          nextRetryAt: new Date(Date.now() + delaySec * 1000).toISOString(),
          errorMessage: `Retry ${nextAttempt} of ${MAX_RETRY_ATTEMPTS}: ${error.message || 'Unknown error'}`,
          launchedBy: batch ? 'batch' : 'automation',
          ...(batch ? { batchRunId: batch.runId, batchRowNumber: batch.rowNumber } : {}),
        };
        await docClient.send(new PutCommand({
          TableName: TableNames.WORKFLOW_INSTANCES,
          Item: instance,
        }));
      } else {
        // Update existing instance with retry progress
        await docClient.send(new UpdateCommand({
          TableName: TableNames.WORKFLOW_INSTANCES,
          Key: { id: instanceId },
          UpdateExpression: 'SET retryCount = :rc, retrySequenceId = :sid, retryMaxAttempts = :max, nextRetryAt = :nra, errorMessage = :err',
          ExpressionAttributeValues: {
            ':rc': nextAttempt,
            ':sid': sequenceId,
            ':max': MAX_RETRY_ATTEMPTS,
            ':nra': new Date(Date.now() + delaySec * 1000).toISOString(),
            ':err': `Retry ${nextAttempt} of ${MAX_RETRY_ATTEMPTS}: ${error.message || 'Unknown error'}`,
          },
        }));
      }

      // Update pipeline entry to reflect retry-in-progress (not fully failed).
      // Bulk Upload jobs have no pipeline entry — the row stays 'launching'.
      if (pipelineEntryId) {
        try {
          await docClient.send(new UpdateCommand({
            TableName: TableNames.TRIGGER_PIPELINE,
            Key: { id: pipelineEntryId },
            UpdateExpression: 'SET #st = :status, errorMessage = :err, userMessage = :userMsg, adminMessage = :adminMsg',
            ExpressionAttributeValues: {
              ':status': 'retrying',
              ':err': error.message || 'Unknown error',
              ':userMsg': `Retrying automatically (attempt ${nextAttempt} of ${MAX_RETRY_ATTEMPTS}). Next retry in ${formatDelay(delaySec)}.`,
              ':adminMsg': `Retry ${nextAttempt}/${MAX_RETRY_ATTEMPTS}: ${error.message}`,
            },
            ExpressionAttributeNames: { '#st': 'status' },
          }));
        } catch { /* best-effort */ }
      }

      // Enqueue retry job with delay
      const retryJob: WorkflowLaunchJob = {
        ...job,
        retry: {
          attempt: nextAttempt,
          maxAttempts: MAX_RETRY_ATTEMPTS,
          sequenceId,
          instanceId,
          // For delays > SQS max (900s), use deferUntil timestamp
          deferUntil: delaySec > SQS_MAX_DELAY_SEC
            ? new Date(Date.now() + delaySec * 1000).toISOString()
            : undefined,
        },
      };

      const sqsDelay = Math.min(delaySec, SQS_MAX_DELAY_SEC);
      await sendMessage(QueueNames.WORKFLOW_LAUNCHER, retryJob, { delaySeconds: sqsDelay });

      log.info({ nextAttempt, delaySec, instanceId, sequenceId },
        `Scheduled retry ${nextAttempt} of ${MAX_RETRY_ATTEMPTS}`);
      return; // Don't throw — we're handling retry ourselves
    }

    // ─── Final failure: all retries exhausted or non-retryable ──

    // Check if this pipeline entry was already marked as failed (SQS retry)
    let isRetry = false;
    if (pipelineEntryId) {
      try {
        const existingEntry = await docClient.send(new GetCommand({
          TableName: TableNames.TRIGGER_PIPELINE,
          Key: { id: pipelineEntryId },
        }));
        isRetry = existingEntry.Item?.status === 'failed';
      } catch { /* ignore lookup errors */ }
    }

    // Mark instance as failed if it exists
    if (retry?.instanceId) {
      try {
        await docClient.send(new UpdateCommand({
          TableName: TableNames.WORKFLOW_INSTANCES,
          Key: { id: retry.instanceId },
          UpdateExpression: 'SET #st = :status, errorMessage = :err, completedAt = :now, nextRetryAt = :noRetry',
          ExpressionAttributeValues: {
            ':status': 'failed',
            ':err': error.message || 'Unknown error',
            ':now': now,
            ':noRetry': null,
          },
          ExpressionAttributeNames: { '#st': 'status' },
        }));
      } catch (updateErr) {
        logError('Failed to mark instance as failed', updateErr);
      }
    }

    // Record the failure: batch row for Bulk Upload, pipeline entry otherwise
    if (batch) {
      try {
        // Conditional update makes the consecutiveFailures counter idempotent
        // across SQS redeliveries — the row only transitions to 'failed' once.
        await docClient.send(new UpdateCommand({
          TableName: TableNames.BATCH_ROWS,
          Key: { runId: batch.runId, rowNumber: batch.rowNumber },
          UpdateExpression: retry?.instanceId
            ? 'SET #st = :status, errorMessage = :err, completedAt = :now, workflowInstanceId = :wid'
            : 'SET #st = :status, errorMessage = :err, completedAt = :now',
          ConditionExpression: '#st <> :status',
          ExpressionAttributeValues: {
            ':status': 'failed',
            ':err': error.message || 'Unknown error',
            ':now': new Date().toISOString(),
            ...(retry?.instanceId ? { ':wid': retry.instanceId } : {}),
          },
          ExpressionAttributeNames: { '#st': 'status' },
        }));

        // Count the failure streak on the run (reset to 0 on any success)
        await docClient.send(new UpdateCommand({
          TableName: TableNames.BATCH_RUNS,
          Key: { id: batch.runId },
          UpdateExpression: 'ADD consecutiveFailures :one',
          ExpressionAttributeValues: { ':one': 1 },
        }));
      } catch (updateError: any) {
        if (updateError.name !== 'ConditionalCheckFailedException') {
          logError('Failed to mark batch row as failed', updateError);
        }
      }
    } else {
      try {
        const errorMessage = error.message || 'Unknown error';
        const userMessage = currentAttempt >= MAX_RETRY_ATTEMPTS
          ? `All ${MAX_RETRY_ATTEMPTS} retry attempts exhausted. ${categorizeUserMessage(errorMessage)}`
          : categorizeUserMessage(errorMessage);
        const adminMessage = `Workflow launch failed: ${errorMessage}`;

        if (pipelineEntryId) {
          await docClient.send(new UpdateCommand({
            TableName: TableNames.TRIGGER_PIPELINE,
            Key: { id: pipelineEntryId },
            UpdateExpression: 'SET #st = :status, errorMessage = :error, userMessage = :userMsg, adminMessage = :adminMsg, errorCategory = :errCat, userActionable = :actionable, completedAt = :now',
            ExpressionAttributeValues: {
              ':status': 'failed',
              ':error': errorMessage,
              ':userMsg': userMessage,
              ':adminMsg': adminMessage,
              ':errCat': errorCategory,
              ':actionable': isUserActionable(errorMessage),
              ':now': new Date().toISOString(),
            },
            ExpressionAttributeNames: { '#st': 'status' },
          }));
        }

        // Only count failure once per pipeline entry (skip on SQS retries)
        if (!isRetry && ruleId) {
          await updateRuleFailure(ruleId, errorMessage, sfDispatchId);
        }
      } catch (updateError) {
        logError('Failed to update pipeline entry on error', updateError);
      }
    }

    // ─── Send failure notification ──────────────────────────
    // Bulk Upload rows skip the per-launch failure fanout — a 5k-row file
    // must not page every admin per row (batch notifications are out of scope).
    if (!isRetry && !batch) {
      try {
        // Fan out to all org admins (the launcher only runs for automation-triggered
        // workflows, so there's no real launching user to notify). Slack routes
        // per-org and must fire only once; in-app + email fan out per admin.
        const adminIds = await getOrgAdmins(orgId);
        if (adminIds.length > 0) {
          const [wfResult, pipelineResult] = await Promise.all([
            docClient.send(new GetCommand({ TableName: TableNames.WORKFLOWS, Key: { id: workflowId } })),
            pipelineEntryId
              ? docClient.send(new GetCommand({ TableName: TableNames.TRIGGER_PIPELINE, Key: { id: pipelineEntryId } }))
              : Promise.resolve({ Item: undefined } as { Item?: Record<string, any> }),
          ]);
          const workflowName = wfResult.Item?.name || 'Unknown';
          const pipelineEntry = pipelineResult.Item;
          const notifExtra = {
            actionNumber: pipelineEntry?.actionNumber as number | undefined,
            automationName: pipelineEntry?.ruleId ? undefined : undefined, // filled below
            platform: pipelineEntry?.sourcePlatform as string | undefined,
          };
          // Fetch rule name for notification title
          let automationName: string | undefined;
          if (pipelineEntry?.ruleId) {
            const ruleResult = await docClient.send(new GetCommand({
              TableName: TableNames.AUTOMATION_RULES,
              Key: { id: pipelineEntry.ruleId },
            }));
            automationName = ruleResult.Item?.name;
          }

          const buildPayload = (adminId: string) =>
            currentAttempt >= MAX_RETRY_ATTEMPTS
              ? retryExhaustedNotification(
                  orgId, adminId, workflowName,
                  retry?.instanceId || pipelineEntryId || workflowId,
                  MAX_RETRY_ATTEMPTS,
                  { ...notifExtra, automationName },
                )
              : workflowFailedNotification(
                  orgId, adminId, workflowName,
                  retry?.instanceId || pipelineEntryId || workflowId,
                  error.message || 'Unknown error',
                  { ...notifExtra, automationName },
                );

          for (let i = 0; i < adminIds.length; i++) {
            const payload = buildPayload(adminIds[i]);
            if (i > 0) payload.channels = ['in_app', 'email'];
            await sendNotification(payload);
          }
        }
      } catch (notifErr) {
        logError('Failed to send failure notification', notifErr);
      }
    }

    // Don't re-throw — we handle retries ourselves now.
    // Bulk Upload rows never re-throw: the row is already marked 'failed' and
    // an SQS redelivery would only duplicate the launch attempt.
    if (!batch && !isRetryable && currentAttempt === 0) {
      // Non-retryable, first attempt, no retry sequence — throw for SQS DLQ
      throw error;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Normalize a field name for comparison: lowercase, strip non-alphanumeric.
 * "Object ID", "object_id", "objectId", "OBJECTID" → "objectid"
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Flatten a payload to leaf string values and promote nested fields to short aliases.
 * Used both when no triggerInputSchema is present and when the schema has no recognised fields.
 * Short (last-segment) aliases are added so a Maestro step using `employeeId` resolves
 * correctly even when the payload nests it as `data.employeeId`. Shallower keys win.
 */
function flattenWithShortAliases(payload: Record<string, any>): Record<string, string> {
  const flat = flattenPayload(payload);
  const leafEntries = Object.entries(flat)
    .filter(([, v]) => v === null || typeof v !== 'object')
    .sort((a, b) => a[0].split('.').length - b[0].split('.').length); // shallower first

  const result: Record<string, string> = {};
  for (const [k, v] of leafEntries) {
    const strVal = v === null ? '' : String(v);
    result[k] = strVal;
    const lastDot = k.lastIndexOf('.');
    if (lastDot >= 0) {
      const shortKey = k.slice(lastDot + 1);
      if (!(shortKey in result)) result[shortKey] = strVal;
    }
  }
  return result;
}

/**
 * Flatten a nested object into dot-notation keys.
 * { a: { b: 1 }, c: 2 } → { 'a.b': 1, c: 2 }
 * Stops at depth 3 to avoid blowing up on deeply nested payloads.
 */
function flattenPayload(
  obj: Record<string, any>,
  prefix = '',
  depth = 0,
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (depth < 3 && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenPayload(value, fullKey, depth + 1));
    }
    // Always include the top-level key as well so exact shallow matches win
    result[fullKey] = value;
  }
  return result;
}

/**
 * Auto-map webhook payload fields to workflow trigger inputs based on schema.
 *
 * If `inputData` contains `__rawPayload` (set by rule-engine when no manual
 * fieldMapping is configured), the function extracts schema field names from
 * `triggerInputSchema` and tries to find a matching key in the payload using:
 *   1. Exact match
 *   2. Case-insensitive / normalized match (strips spaces, underscores, dashes)
 *   3. Dot-notation nested match (e.g. schema field "project_id" ← payload "data.project_id")
 *
 * If manual field mappings were used (no `__rawPayload`), `inputData` is
 * returned as-is — the mapper already did the work.
 *
 * If the workflow has no `triggerInputSchema` (or the schema has no recognisable
 * fields), the payload is flattened with short aliases so nested fields like
 * `data.employeeId` are accessible as `employeeId` in Maestro.
 */
function autoMapFromSchema(
  inputData: Record<string, any>,
  triggerInputSchema: Record<string, any> | undefined,
): Record<string, any> {
  // Manual mapping already applied — nothing to do
  if (!inputData.__rawPayload) return inputData;

  const payload = inputData.__rawPayload as Record<string, any>;

  // No schema — flatten and promote nested fields to short aliases.
  if (!triggerInputSchema) {
    return flattenWithShortAliases(payload);
  }

  // Extract field names from both schema formats Maestro uses:
  //   Array format:  [{ field_name: 'project_id', ... }, ...]
  //   JSON Schema:   { properties: { project_id: { type: 'string' }, ... } }
  let schemaFields: string[] = [];

  if (Array.isArray(triggerInputSchema)) {
    schemaFields = triggerInputSchema
      .map((f: any) => f.field_name || f.name)
      .filter(Boolean);
  } else if (triggerInputSchema.properties && typeof triggerInputSchema.properties === 'object') {
    schemaFields = Object.keys(triggerInputSchema.properties);
  }

  // Schema present but no recognisable fields (e.g. empty `properties: {}`).
  // Maestro often returns `{ type: 'object', properties: {} }` for webhook triggers —
  // returning the raw nested payload here would bury `data.employeeId` one level deep
  // and Maestro would show it as null. Flatten instead so short aliases are available.
  if (schemaFields.length === 0) return flattenWithShortAliases(payload);

  // Build a lookup: normalizedKey → { originalPayloadKey, value }
  // Each flattened key is indexed two ways:
  //   1. Full path normalized: "data.project_id" → "dataprojectid"
  //   2. Last segment normalized: "data.project_id" → "projectid"
  // This lets schema field "project_id" match a nested payload "data.project_id".
  // Shallower paths win on collision (fewer dots = higher priority).
  const flat = flattenPayload(payload);
  const normalizedLookup = new Map<string, { key: string; value: any }>();

  function addToLookup(norm: string, key: string, value: any) {
    const existing = normalizedLookup.get(norm);
    const depth = key.split('.').length;
    if (!existing || depth < existing.key.split('.').length) {
      normalizedLookup.set(norm, { key, value });
    }
  }

  for (const [key, value] of Object.entries(flat)) {
    addToLookup(normalizeKey(key), key, value);
    const lastSegment = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : null;
    if (lastSegment) {
      addToLookup(normalizeKey(lastSegment), key, value);
    }
  }

  const result: Record<string, any> = {};
  for (const field of schemaFields) {
    let value: any;

    // 1. Exact match in the top-level payload
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      value = payload[field];
    } else {
      // 2. Normalized match across all flat keys
      const match = normalizedLookup.get(normalizeKey(field));
      if (match !== undefined) value = match.value;
    }

    if (value !== undefined) {
      // Maestro expects all trigger inputs as strings
      result[field] = value === null ? '' : String(value);
    }
  }

  return result;
}

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${Math.round(seconds / 3600)}h`;
}

// ─── Rule Stats Helpers ──────────────────────────────────────

async function updateRuleSuccess(ruleId: string): Promise<void> {
  const docClient = getDocClient();
  const rule = await docClient.send(new GetCommand({
    TableName: TableNames.AUTOMATION_RULES,
    Key: { id: ruleId },
  }));

  if (!rule.Item) return;

  const total = (rule.Item.timesTriggered || 0);
  const failures = Math.min(rule.Item.failureCount || 0, total);
  const successRate = total > 0 ? Math.round(((total - failures) / total) * 100) : 100;

  await docClient.send(new UpdateCommand({
    TableName: TableNames.AUTOMATION_RULES,
    Key: { id: ruleId },
    UpdateExpression: 'SET successRate = :rate, updatedAt = :now',
    ExpressionAttributeValues: { ':rate': successRate, ':now': new Date().toISOString() },
  }));
}

async function updateRuleFailure(ruleId: string, errorMessage: string, sfDispatchId?: string): Promise<void> {
  const docClient = getDocClient();
  const rule = await docClient.send(new GetCommand({
    TableName: TableNames.AUTOMATION_RULES,
    Key: { id: ruleId },
  }));

  if (!rule.Item) return;

  const total = (rule.Item.timesTriggered || 0);
  const failures = Math.min((rule.Item.failureCount || 0) + 1, total);
  const successRate = total > 0 ? Math.round(((total - failures) / total) * 100) : 0;

  await docClient.send(new UpdateCommand({
    TableName: TableNames.AUTOMATION_RULES,
    Key: { id: ruleId },
    UpdateExpression: 'SET failureCount = failureCount + :inc, successRate = :rate, lastError = :err, updatedAt = :now',
    ExpressionAttributeValues: {
      ':inc': 1,
      ':rate': successRate,
      ':err': { message: errorMessage, at: new Date().toISOString() },
      ':now': new Date().toISOString(),
    },
  }));

  // Auto-pause rule if failure rate is too high (>50% over 5+ triggers)
  if (total >= 5 && successRate < 50) {
    logError('Auto-pausing rule due to high failure rate', { ruleId, successRate, failures, total, sfDispatchId });
    await docClient.send(new UpdateCommand({
      TableName: TableNames.AUTOMATION_RULES,
      Key: { id: ruleId },
      UpdateExpression: 'SET #st = :status, updatedAt = :now',
      ExpressionAttributeValues: { ':status': 'error', ':now': new Date().toISOString() },
      ExpressionAttributeNames: { '#st': 'status' },
    }));

    // Notify about auto-pause
    try {
      const adminId = await getOrgAdmin(rule.Item.orgId);
      if (adminId) {
        await sendNotification(rulePausedNotification(
          rule.Item.orgId,
          adminId,
          rule.Item.name || ruleId,
          `High failure rate (${successRate}%) after ${total} triggers`,
        ));
      }
    } catch (notifErr) {
      logError('Failed to send rule-paused notification', notifErr);
    }
  }
}

// ─── Error Categorization ────────────────────────────────────

function categorizeError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('token')) return 'auth';
  if (lower.includes('400') || lower.includes('validation') || lower.includes('invalid')) return 'validation';
  if (lower.includes('429') || lower.includes('rate limit')) return 'rate_limit';
  if (lower.includes('502') || lower.includes('503') || lower.includes('timeout')) return 'upstream';
  return 'internal';
}

function categorizeUserMessage(errorMessage: string): string {
  const category = categorizeError(errorMessage);
  switch (category) {
    case 'auth':
      return 'Your DocuSign connection may have expired. Please reconnect in Settings → Connections.';
    case 'validation':
      return 'The workflow could not be launched because the input data was invalid. Check the rule field mapping.';
    case 'rate_limit':
      return 'DocuSign API rate limit reached. The system will retry automatically.';
    case 'upstream':
      return 'DocuSign service is temporarily unavailable. The system will retry automatically.';
    default:
      return 'An unexpected error occurred while launching the workflow. Our team has been notified.';
  }
}

function isUserActionable(errorMessage: string): boolean {
  const category = categorizeError(errorMessage);
  return category === 'auth' || category === 'validation';
}

// @visibleForTesting
export const _testExports = { categorizeError, categorizeUserMessage, isUserActionable, RETRY_DELAYS_SEC, MAX_RETRY_ATTEMPTS, formatDelay };
