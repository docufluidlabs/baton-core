/**
 * Instance Routes — Baton
 * Workflow instance management and status tracking
 */
import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { requireViewer, requireMember } from '../middleware/rbac';
import { NotFoundError } from '../middleware/error-handler';
import { logInfo, logError } from '../lib/logger';
import { WorkflowInstance, Workflow } from '../lib/types';
import env from '../env';
import * as maestroService from '../services/maestro.service';
import * as connectionService from '../services/connection.service';
import { countCompletionIfNeeded } from '../services/usage.service';
import { sendMessage, QueueNames } from '../queue/sqs-client';

const router = Router();
router.use(requireAuth);

// ─── GET /api/instances — List instances for org ─────────────

router.get('/', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const status = req.query.status as string;
    const ruleId = req.query.ruleId as string;

    const docClient = getDocClient();

    // Build filter expression dynamically
    const filters: string[] = [];
    const exprValues: Record<string, any> = { ':orgId': orgId };
    const exprNames: Record<string, string> = {};

    if (status) {
      filters.push('#st = :status');
      exprValues[':status'] = status;
      exprNames['#st'] = 'status';
    }
    if (ruleId) {
      filters.push('triggerRuleId = :ruleId');
      exprValues[':ruleId'] = ruleId;
    }

    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      IndexName: 'orgId-startedAt-index',
      KeyConditionExpression: 'orgId = :orgId',
      ...(filters.length > 0 ? {
        FilterExpression: filters.join(' AND '),
        ExpressionAttributeValues: exprValues,
        ...(Object.keys(exprNames).length > 0 ? { ExpressionAttributeNames: exprNames } : {}),
      } : {
        ExpressionAttributeValues: exprValues,
      }),
      ScanIndexForward: false,
      Limit: limit,
    }));

    res.json({ instances: result.Items || [] });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/instances/counts — Status counts per workflow ───

router.get('/counts', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    // Scan all org instances (DynamoDB can't group-by, so we aggregate in-memory)
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      IndexName: 'orgId-startedAt-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
      ProjectionExpression: 'workflowId, #st',
      ExpressionAttributeNames: { '#st': 'status' },
    }));

    const counts: Record<string, { completed: number; failed: number; cancelled: number; running: number }> = {};
    for (const item of (result.Items || []) as { workflowId: string; status: string }[]) {
      if (!counts[item.workflowId]) {
        counts[item.workflowId] = { completed: 0, failed: 0, cancelled: 0, running: 0 };
      }
      const status = item.status as keyof typeof counts[string];
      if (status in counts[item.workflowId]) {
        counts[item.workflowId][status]++;
      }
    }

    res.json({ counts });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/instances/:id — Get instance details ───────────

router.get('/:id', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docClient = getDocClient();
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: req.params.id },
    }));

    const instance = result.Item as WorkflowInstance;
    if (!instance || instance.orgId !== req.auth!.orgId) throw new NotFoundError('Instance');

    res.json({ instance });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/instances/:id/live — Get live status from Maestro

router.get('/:id/live', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docClient = getDocClient();
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: req.params.id },
    }));

    const instance = result.Item as WorkflowInstance;
    if (!instance || instance.orgId !== req.auth!.orgId) throw new NotFoundError('Instance');

    if (!instance.maestroInstanceId) {
      res.json({ instance, live: false });
      return;
    }

    // Fetch live status from Maestro
    const workflow = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOWS,
      Key: { id: instance.workflowId },
    }));

    const wf = workflow.Item;
    if (!wf?.connectionId || !wf?.maestroWorkflowId) {
      res.json({ instance, live: false });
      return;
    }

    const maestroInstance = await maestroService.getInstance(
      wf.connectionId,
      wf.maestroWorkflowId,
      instance.maestroInstanceId,
    );

    // Update local record with latest Maestro data — but never override a
    // manual cancel (user clicked Cancel in Baton). Maestro may still report
    // the pre-cancel terminal state (e.g. 'failed') and would otherwise reset
    // our local 'cancelled' status on every poll.
    const manualCancel = instance.status === 'cancelled' && !!instance.manuallyCancelledAt;
    const statusChanged = !manualCancel && maestroInstance.status !== instance.status;
    const stepChanged = maestroInstance.lastCompletedStep !== instance.lastCompletedStep;

    if (statusChanged || stepChanged) {
      logInfo('Instance status synced from Workflow Builder', {
        instanceId: instance.id,
        oldStatus: instance.status,
        newStatus: maestroInstance.status,
        stepChanged,
      });
      await docClient.send(new UpdateCommand({
        TableName: TableNames.WORKFLOW_INSTANCES,
        Key: { id: instance.id },
        UpdateExpression: 'SET #st = :status, currentStep = :step, lastCompletedStep = :lastStep, lastCompletedStepName = :lastStepName, totalSteps = :totalSteps, completedAt = :completedAt',
        ExpressionAttributeValues: {
          ':status': maestroInstance.status,
          ':step': maestroInstance.lastStep || null,
          ':lastStep': maestroInstance.lastCompletedStep ?? null,
          ':lastStepName': maestroInstance.lastCompletedStepName || null,
          ':totalSteps': maestroInstance.totalSteps ?? null,
          ':completedAt': maestroInstance.endDate || null,
        },
        ExpressionAttributeNames: { '#st': 'status' },
      }));

      // Count successful completion (idempotent)
      if (maestroInstance.status === 'completed') {
        await countCompletionIfNeeded(instance.id, instance.orgId);
      }
    }

    res.json({
      instance: {
        ...instance,
        status: manualCancel ? instance.status : maestroInstance.status,
        currentStep: maestroInstance.lastStep,
        lastCompletedStep: maestroInstance.lastCompletedStep,
        lastCompletedStepName: maestroInstance.lastCompletedStepName,
        totalSteps: maestroInstance.totalSteps,
      },
      maestro: maestroInstance,
      live: true,
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/instances/:id/retry — Manual retry ─────────────
// Resets the retry sequence so stale auto-retries are abandoned,
// then enqueues a fresh launch job that starts a new retry chain.

router.post('/:id/retry', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docClient = getDocClient();
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: req.params.id },
    }));

    const instance = result.Item as WorkflowInstance | undefined;
    if (!instance || instance.orgId !== req.auth!.orgId) throw new NotFoundError('Instance');

    if (instance.status !== 'failed' && instance.status !== 'running' && instance.status !== 'cancelled') {
      res.status(400).json({ error: `Cannot retry instance in "${instance.status}" status` });
      return;
    }

    // Lookup parent workflow
    const wfResult = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOWS,
      Key: { id: instance.workflowId },
    }));
    const workflow = wfResult.Item as Workflow | undefined;
    if (!workflow?.maestroWorkflowId) {
      res.status(400).json({ error: 'Workflow has no Workflow Builder ID' });
      return;
    }

    // Generate new retry sequence ID — invalidates any pending auto-retries
    const newSequenceId = uuidv4();

    await docClient.send(new UpdateCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: instance.id },
      UpdateExpression: 'SET #st = :status, retryCount = :rc, retrySequenceId = :sid, retryMaxAttempts = :max, nextRetryAt = :noRetry, errorMessage = :noErr, manuallyRetriedAt = :now',
      ExpressionAttributeValues: {
        ':status': 'running',
        ':rc': 0,
        ':sid': newSequenceId,
        ':max': 6,
        ':noRetry': null,
        ':noErr': null,
        ':now': new Date().toISOString(),
      },
      ExpressionAttributeNames: { '#st': 'status' },
    }));

    // Find the trigger rule ID (needed for the launch job)
    const ruleId = instance.triggerRuleId || 'manual';

    // Enqueue a fresh launch job with the instance linked
    await sendMessage(QueueNames.WORKFLOW_LAUNCHER, {
      ruleId,
      pipelineEntryId: instance.id, // reuse instance ID as pipeline ref
      workflowId: instance.workflowId,
      orgId: instance.orgId,
      inputData: instance.inputData || {},
      instanceName: instance.instanceName,
      retry: {
        attempt: 0,   // will be treated as initial attempt
        maxAttempts: 6,
        sequenceId: newSequenceId,
        instanceId: instance.id,
      },
    });

    logInfo('Manual retry initiated', { instanceId: instance.id, newSequenceId });
    res.json({ message: 'Retry initiated', id: instance.id });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/instances/:id/postpone — Push back the Overdue deadline ─
// Grants a running instance more time: it leaves the Overdue list and only
// resurfaces there `days` from now (if still running). The snooze overrides
// the rule's expectedDurationDays threshold, counting from the moment of the
// postpone rather than from startedAt.

router.post('/:id/postpone', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Number(req.body?.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      res.status(400).json({ error: 'days must be an integer between 1 and 365' });
      return;
    }

    const docClient = getDocClient();
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: req.params.id },
    }));

    const instance = result.Item as WorkflowInstance | undefined;
    if (!instance || instance.orgId !== req.auth!.orgId) throw new NotFoundError('Instance');

    if (instance.status !== 'running') {
      res.status(400).json({ error: `Cannot postpone instance in "${instance.status}" status` });
      return;
    }

    const snoozeUntil = new Date(Date.now() + days * 86_400_000).toISOString();
    await docClient.send(new UpdateCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: instance.id },
      UpdateExpression: 'SET overdueSnoozedUntil = :until',
      ExpressionAttributeValues: { ':until': snoozeUntil },
    }));

    logInfo('Instance overdue postponed', { instanceId: instance.id, days, snoozeUntil });
    res.json({ message: 'Instance postponed', id: instance.id, overdueSnoozedUntil: snoozeUntil });
  } catch (error) {
    next(error);
  }
});

// ─── PUT /api/instances/:id/tags — Set org-shared instance tags ─
// Tags are shared across everyone in the org (stored on the instance record),
// unlike the old per-browser localStorage tags that never synced. The caller
// sends the full list, which replaces what's stored — keeping add/remove a
// single idempotent write with no merge races.

const MAX_TAGS = 20;
const MAX_TAG_LEN = 30;

router.put('/:id/tags', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.body?.tags;
    if (!Array.isArray(raw) || raw.some((t) => typeof t !== 'string')) {
      res.status(400).json({ error: 'tags must be an array of strings' });
      return;
    }

    // Normalize: trim, cap length, drop blanks, dedupe (preserving order).
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const t of raw as string[]) {
      const v = t.trim().slice(0, MAX_TAG_LEN);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      tags.push(v);
    }
    if (tags.length > MAX_TAGS) {
      res.status(400).json({ error: `A maximum of ${MAX_TAGS} tags is allowed` });
      return;
    }

    const docClient = getDocClient();
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: req.params.id },
    }));

    const instance = result.Item as WorkflowInstance | undefined;
    if (!instance || instance.orgId !== req.auth!.orgId) throw new NotFoundError('Instance');

    await docClient.send(new UpdateCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: instance.id },
      UpdateExpression: 'SET tags = :tags',
      ExpressionAttributeValues: { ':tags': tags },
    }));

    logInfo('Instance tags updated', { instanceId: instance.id, count: tags.length });
    res.json({ id: instance.id, tags });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/instances/:id/cancel — Cancel instance ────────

router.post('/:id/cancel', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docClient = getDocClient();
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: req.params.id },
    }));

    const instance = result.Item as WorkflowInstance;
    if (!instance || instance.orgId !== req.auth!.orgId) throw new NotFoundError('Instance');

    if (instance.maestroInstanceId) {
      const workflow = await docClient.send(new GetCommand({
        TableName: TableNames.WORKFLOWS,
        Key: { id: instance.workflowId },
      }));

      const wf = workflow.Item;
      if (wf?.maestroWorkflowId) {
        // Resolve a valid DocuSign connection
        let dsConnId = wf.connectionId;
        if (dsConnId) {
          const conn = await connectionService.getConnection(dsConnId);
          if (!conn || conn.platform !== 'docusign') dsConnId = undefined;
        }
        if (!dsConnId) {
          const orgConns = await connectionService.getConnectionsByOrg(instance.orgId);
          dsConnId = orgConns.find((c: any) => c.platform === 'docusign' && c.status === 'healthy')?.id;
        }
        if (dsConnId) {
          // Maestro returns 4xx if the instance is already terminal — that's
          // fine, we still want to record the manual cancel locally so the
          // user's intent is reflected in the UI.
          try {
            await maestroService.cancelInstance(dsConnId, wf.maestroWorkflowId, instance.maestroInstanceId);
          } catch (err) {
            logInfo('Workflow Builder cancel rejected - proceeding with local cancel', {
              instanceId: instance.id,
              error: (err as Error)?.message,
            });
          }
        }
      }
    }

    // Update local status
    const nowIso = new Date().toISOString();
    await docClient.send(new UpdateCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Key: { id: instance.id },
      UpdateExpression: 'SET #st = :status, completedAt = :now, manuallyCancelledAt = :now',
      ExpressionAttributeValues: { ':status': 'cancelled', ':now': nowIso },
      ExpressionAttributeNames: { '#st': 'status' },
    }));

    logInfo('Instance cancelled', { instanceId: instance.id });
    res.json({ message: 'Instance cancelled', id: instance.id });
  } catch (error) {
    next(error);
  }
});


export default router;
