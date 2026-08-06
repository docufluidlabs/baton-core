/**
 * Batch Processor Routes — Baton (Bulk Upload)
 *
 * CRUD for Bulk Upload processors plus the run lifecycle:
 * upload → preflight → start → (dispatcher releases rows) → pause/resume/cancel.
 *
 * Wired to: batch.service, instance.service (shared cancel), maestro.service.
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { requireMember, requireViewer } from '../middleware/rbac';
import { NotFoundError, ValidationError } from '../middleware/error-handler';
import { logInfo } from '../lib/logger';
import { logAudit } from '../services/audit.service';
import * as batchService from '../services/batch.service';
import { removeFlowPositions } from '../services/flow-layout.service';
import * as maestroService from '../services/maestro.service';
import * as connectionService from '../services/connection.service';
import { cancelWorkflowInstance } from '../services/instance.service';
import { getRelayGate } from '../lib/billing-hooks';
import { BatchProcessor, BatchRow, BatchRun, Workflow, WorkflowInstance } from '../lib/types';
import {
  CreateBatchProcessorInput,
  UpdateBatchProcessorInput,
  BatchPreflightInput,
  BatchStartInput,
  BatchCancelInput,
} from '../docs/schemas/batch';

const router = Router();
router.use(requireAuth);

// Validation schemas live in src/docs/schemas/batch.ts.

// Multer is applied to the upload route ONLY — everything else is JSON.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB cap
});

const TERMINAL_INSTANCE_STATUSES = new Set(['completed', 'failed', 'cancelled']);

// ─── Helpers ────────────────────────────────────────────────

async function loadProcessor(req: Request): Promise<BatchProcessor> {
  const processor = await batchService.getProcessor(req.params.id as string);
  if (!processor || processor.orgId !== req.auth!.orgId) throw new NotFoundError('Bulk Upload');
  return processor;
}

async function loadRun(processor: BatchProcessor, runId: string): Promise<BatchRun> {
  const run = await batchService.getRun(runId);
  if (!run || run.batchProcessorId !== processor.id || run.orgId !== processor.orgId) {
    throw new NotFoundError('Run');
  }
  return run;
}

function toRunSummary(run: BatchRun, rows: BatchRow[]) {
  return {
    id: run.id,
    runNumber: run.runNumber,
    fileName: run.fileName,
    status: run.status,
    totalRows: run.totalRows,
    selectedRows: run.selectedRows ?? null,
    counts: batchService.computeRowCounts(rows),
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    nextReleaseAt: run.nextReleaseAt ?? null,
  };
}

async function assertTargetWorkflow(orgId: string, workflowId: string): Promise<Workflow> {
  const docClient = getDocClient();
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.WORKFLOWS,
    Key: { id: workflowId },
  }));
  const workflow = result.Item as Workflow | undefined;
  if (!workflow || workflow.orgId !== orgId) {
    throw new ValidationError('Target workflow not found. Sync workflows and pick an existing one.');
  }
  return workflow;
}

// ─── GET /api/batch-processors — List processors + run summaries ──

router.get('/', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const processors = await batchService.getProcessorsByOrg(orgId);

    const enriched = [];
    for (const processor of processors) {
      const runs = await batchService.getRunsByProcessor(processor.id);
      const activeRun = runs.find((r) => r.status === 'running' || r.status === 'paused');
      const lastRun = runs.find((r) => r.status !== 'draft' && r.status !== 'queued');

      const summaries = new Map<string, ReturnType<typeof toRunSummary>>();
      for (const run of [activeRun, lastRun]) {
        if (run && !summaries.has(run.id)) {
          const rows = await batchService.getRowsByRun(run.id);
          summaries.set(run.id, toRunSummary(run, rows));
        }
      }

      // Runs waiting behind the active one, oldest first. No rows fetch -
      // nothing has been released yet, so the counts persisted at start time
      // (queuedRows/skippedRows) are still exact.
      const queuedRuns = runs
        .filter((r) => r.status === 'queued')
        .sort((a, b) => (a.runNumber ?? 0) - (b.runNumber ?? 0))
        .map((r) => ({
          id: r.id,
          runNumber: r.runNumber,
          fileName: r.fileName,
          status: r.status,
          totalRows: r.totalRows,
          selectedRows: r.selectedRows ?? 0,
          counts: {
            queued: r.queuedRows ?? r.selectedRows ?? 0,
            running: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            skipped: r.skippedRows ?? 0,
          },
        }));

      // Sequence aggregates for the card. "Processed" counts rows that are no
      // longer waiting: all rows of completed/cancelled runs plus the active
      // run's released rows. Stopped runs still hold queued rows, so they are
      // deliberately excluded rather than guessed at.
      const sequenced = runs.filter((r) => r.status !== 'draft');
      const activeSummary = activeRun ? summaries.get(activeRun.id) : undefined;
      const rowsProcessed =
        sequenced
          .filter((r) => r.status === 'completed' || r.status === 'cancelled')
          .reduce((sum, r) => sum + (r.selectedRows ?? 0), 0) +
        (activeSummary ? Math.max(0, (activeSummary.selectedRows ?? 0) - activeSummary.counts.queued) : 0);

      enriched.push({
        ...processor,
        lastRun: lastRun ? summaries.get(lastRun.id) : undefined,
        activeRun: activeSummary,
        queuedRuns,
        runsTotal: sequenced.length,
        rowsTotal: sequenced.reduce((sum, r) => sum + (r.selectedRows ?? 0), 0),
        rowsProcessed,
      });
    }

    res.json({ processors: enriched });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/batch-processors — Create processor ──────────

router.post('/', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateBatchProcessorInput.parse(req.body);
    const orgId = req.auth!.orgId;

    await assertTargetWorkflow(orgId, data.targetWorkflowId);

    const processor = await batchService.createProcessor({
      ...data,
      orgId,
      createdBy: req.auth!.userId,
    });

    logInfo('Batch processor created via API', { processorId: processor.id, orgId });
    res.status(201).json({ processor });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/batch-processors/:id — Update processor ─────

router.patch('/:id', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = UpdateBatchProcessorInput.parse(req.body);
    const processor = await loadProcessor(req);

    if (updates.targetWorkflowId && updates.targetWorkflowId !== processor.targetWorkflowId) {
      await assertTargetWorkflow(processor.orgId, updates.targetWorkflowId);
    }

    await batchService.updateProcessor(processor.id, updates);
    const updated = await batchService.getProcessor(processor.id);
    res.json({ processor: updated });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /api/batch-processors/:id — Delete processor ────

router.delete('/:id', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const processor = await loadProcessor(req);

    const runs = await batchService.getRunsByProcessor(processor.id);
    if (runs.some((r) => r.status === 'running' || r.status === 'paused' || r.status === 'queued')) {
      throw new ValidationError('A run is still active or queued. Cancel it in the run logs before deleting this Bulk Upload.');
    }

    await batchService.deleteProcessor(processor.id);
    await removeFlowPositions(req.auth!.orgId, [`batch-${processor.id}`]);
    res.json({ message: 'Bulk Upload removed', id: processor.id });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/batch-processors/:id/uploads — Upload + parse file ──
// multipart/form-data, field "file". Optional ?sheet=SheetName for XLSX.

router.post(
  '/:id/uploads',
  requireMember,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          next(new ValidationError('The file is larger than 10MB. Split it into smaller files and try again.'));
          return;
        }
        next(err);
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const processor = await loadProcessor(req);
      if (!req.file) {
        throw new ValidationError('Attach a CSV, XLSX or TSV file in the "file" field.');
      }

      // Uploading while a run is active is allowed - the new run enters the
      // processor's queue at start time and runs after the current one.
      const sheet = typeof req.query.sheet === 'string' && req.query.sheet ? req.query.sheet : undefined;
      const parsed = batchService.parseSpreadsheetBuffer(req.file.buffer, req.file.originalname, sheet);

      // Re-upload replaces the previous draft run
      await batchService.deleteDraftRuns(processor.id);
      const run = await batchService.createRunWithRows({
        processor,
        fileName: req.file.originalname,
        parsed,
        createdBy: req.auth!.userId,
      });

      logAudit({
        orgId: processor.orgId,
        userId: req.auth!.userId,
        action: 'batch.upload',
        resourceType: 'batch',
        resourceId: run.id,
        metadata: { fileName: run.fileName, rows: run.totalRows, blankRowsSkipped: parsed.blankRowsSkipped },
      });

      res.json({
        runId: run.id,
        columns: parsed.columns,
        totalRows: parsed.rows.length,
        blankRowsSkipped: parsed.blankRowsSkipped,
        sheetNames: parsed.sheetNames,
        sheetName: parsed.sheetName,
        preview: parsed.rows.slice(0, 3),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ─── POST /:id/runs/:runId/preflight — Validate rows + pin schema ──

router.post('/:id/runs/:runId/preflight', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mapping, rowSelection, settings } = BatchPreflightInput.parse(req.body);
    const processor = await loadProcessor(req);
    const run = await loadRun(processor, req.params.runId as string);
    const orgId = processor.orgId;

    if (run.status !== 'draft') {
      throw new ValidationError('Preflight is only available for a draft run.');
    }

    const workflow = await assertTargetWorkflow(orgId, processor.targetWorkflowId);

    // Fetch FRESH trigger requirements and pin them on the run (schema pinning).
    // If Workflow Builder is unreachable, fall back to the schema stored on
    // the workflow.
    let schemaSnapshot: Record<string, any> | undefined;
    try {
      let connectionId = workflow.connectionId;
      if (connectionId) {
        const conn = await connectionService.getConnection(connectionId);
        if (!conn || conn.platform !== 'docusign') connectionId = undefined;
      }
      if (!connectionId) {
        connectionId = (await connectionService.getConnectionByOrgAndPlatform(orgId, 'docusign'))?.id;
      }
      if (connectionId && workflow.maestroWorkflowId) {
        const triggerReqs = await maestroService.getTriggerRequirements(connectionId, workflow.maestroWorkflowId);
        schemaSnapshot = triggerReqs.triggerInputSchema;
      }
    } catch (err: any) {
      logInfo('Fresh trigger requirements unavailable - falling back to stored schema', {
        runId: run.id,
        error: err.message,
      });
    }
    if (!schemaSnapshot) schemaSnapshot = workflow.triggerInputSchema;

    const rows = await batchService.getRowsByRun(run.id);
    const validation = batchService.validateRunRows(rows, schemaSnapshot, mapping, rowSelection);

    // Persist per-row included/problems + the pinned schema and settings
    await batchService.putRows(validation.rows);
    await batchService.updateRun(run.id, {
      mapping,
      rowSelection,
      settings,
      schemaSnapshot: schemaSnapshot ?? {},
      selectedRows: validation.selectedCount,
    });

    const estimatedMinutes =
      Math.max(0, Math.ceil(validation.readyRows / settings.releaseCount) - 1) * settings.intervalMinutes;

    res.json({
      readyRows: validation.readyRows,
      problemRows: validation.problemRows,
      unmappedRequired: validation.unmappedRequired,
      estimatedMinutes,
      // The open core has no usage metering - the hosted edition's billing
      // seam (lib/billing-hooks) is where real plan numbers come from.
      planUsage: {
        used: null,
        included: null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /:id/runs/:runId/start — Queue rows + start the run ──

router.post('/:id/runs/:runId/start', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mapping, rowSelection, settings, skipProblemRows } = BatchStartInput.parse(req.body);
    const processor = await loadProcessor(req);
    const run = await loadRun(processor, req.params.runId as string);

    if (run.status !== 'draft') {
      throw new ValidationError('Only a draft run can be started.');
    }
    if (run.schemaSnapshot === undefined) {
      throw new ValidationError('Run preflight before starting this run.');
    }

    // Relay gate (billing seam): the open core's default gate allows
    // everything; the hosted edition injects plan/cap enforcement.
    const gate = await getRelayGate().check(processor.orgId);
    if (!gate.allowed) {
      throw new ValidationError(gate.reason || 'Relay limit reached.');
    }

    const rows = await batchService.getRowsByRun(run.id);
    const validation = batchService.validateRunRows(rows, run.schemaSnapshot, mapping, rowSelection);

    let seq = 0;
    let queuedCount = 0;
    let skippedCount = 0;
    const toPersist: BatchRow[] = validation.rows.map((row) => {
      if (!row.included) {
        return { ...row, status: 'staged' as const, seq: undefined };
      }
      seq++;
      const skip = row.problems.length > 0 && skipProblemRows;
      if (skip) skippedCount++; else queuedCount++;
      return { ...row, status: skip ? 'skipped' as const : 'queued' as const, seq };
    });
    await batchService.putRows(toPersist);

    // One run at a time per processor, in strict sequence: if any sibling is
    // active OR already waiting, this run queues behind it (a new start must
    // never jump ahead of earlier-queued files). Rows are safe either way -
    // the dispatcher only releases rows of runs whose status is 'running'.
    // The dispatcher's reconciliation sweep self-heals the rare two-tabs race
    // where two starts land on an idle processor simultaneously.
    const siblingRuns = await batchService.getRunsByProcessor(processor.id);
    const mustQueue = siblingRuns.some(
      (r) => r.id !== run.id && (r.status === 'running' || r.status === 'paused' || r.status === 'queued'),
    );

    const now = new Date().toISOString();
    await batchService.updateRun(run.id, {
      status: mustQueue ? 'queued' : 'running',
      ...(mustQueue ? {} : { startedAt: now, nextReleaseAt: now }),
      mapping,
      rowSelection,
      settings,
      selectedRows: validation.selectedCount,
      // Persisted so run summaries can report exact queued/skipped counts
      // without fetching rows (see GET / queuedRuns).
      queuedRows: queuedCount,
      skippedRows: skippedCount,
      consecutiveFailures: 0,
    });
    const updated = await batchService.getRun(run.id);

    logInfo(mustQueue ? 'Batch run queued behind active run' : 'Batch run started', { runId: run.id, queued: queuedCount, skipped: skippedCount });
    logAudit({
      orgId: processor.orgId,
      userId: req.auth!.userId,
      action: 'batch.run_started',
      resourceType: 'batch',
      resourceId: run.id,
      metadata: { fileName: run.fileName, rows: validation.selectedCount, queued: queuedCount, skipped: skippedCount },
    });

    res.json({ run: updated });
  } catch (error) {
    next(error);
  }
});

// ─── GET /:id/runs — Run list (newest first) ────────────────

router.get('/:id/runs', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const processor = await loadProcessor(req);
    const runs = (await batchService.getRunsByProcessor(processor.id)).filter((r) => r.status !== 'draft');

    const out = [];
    for (const run of runs) {
      const rows = await batchService.getRowsByRun(run.id);
      out.push({
        ...toRunSummary(run, rows),
        settings: run.settings ?? null,
        columns: run.columns,
      });
    }

    res.json({ runs: out });
  } catch (error) {
    next(error);
  }
});

// ─── GET /:id/runs/:runId/rows?status= — Row list with instances ──

router.get('/:id/runs/:runId/rows', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const processor = await loadProcessor(req);
    const run = await loadRun(processor, req.params.runId as string);

    const rows = await batchService.getRowsByRun(run.id);
    const resolved = await batchService.resolveRowInstanceStatuses(rows);

    const statusFilter = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    const filtered = statusFilter ? resolved.filter((r) => r.displayStatus === statusFilter) : resolved;

    res.json({
      rows: filtered.map((r) => ({
        rowNumber: r.rowNumber,
        seq: r.seq ?? null,
        name: batchService.buildRowName(run, r),
        status: r.displayStatus,
        problems: r.problems || [],
        data: r.data,
        workflowInstanceId: r.workflowInstanceId ?? null,
        maestroInstanceId: r.maestroInstanceId ?? null,
        instance: r.instance
          ? {
              status: r.instance.status,
              currentStep: r.instance.currentStep ?? null,
              lastCompletedStep: r.instance.lastCompletedStep ?? null,
              totalSteps: r.instance.totalSteps ?? null,
              instanceUrl: r.instance.instanceUrl ?? null,
            }
          : undefined,
        errorMessage: r.errorMessage ?? null,
        launchedAt: r.launchedAt ?? null,
        completedAt: r.completedAt ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /:id/runs/:runId/pause — running → paused ─────────

router.post('/:id/runs/:runId/pause', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const processor = await loadProcessor(req);
    const run = await loadRun(processor, req.params.runId as string);

    if (run.status !== 'running') {
      throw new ValidationError('Only a running run can be paused.');
    }
    await batchService.updateRun(run.id, { status: 'paused' });

    logInfo('Batch run paused', { runId: run.id });
    res.json({ run: await batchService.getRun(run.id) });
  } catch (error) {
    next(error);
  }
});

// ─── POST /:id/runs/:runId/resume — paused|stopped → running ──

router.post('/:id/runs/:runId/resume', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const processor = await loadProcessor(req);
    const run = await loadRun(processor, req.params.runId as string);

    if (run.status !== 'paused' && run.status !== 'stopped') {
      throw new ValidationError('Only a paused or stopped run can be resumed.');
    }

    // If the queue moved on while this run sat stopped (the dispatcher
    // promotes the next queued run past a stopped one), resuming must rejoin
    // the sequence instead of producing two concurrently running runs. Being
    // the oldest by run number, it goes next.
    const siblings = await batchService.getRunsByProcessor(processor.id);
    const hasRunningSibling = siblings.some((r) => r.id !== run.id && r.status === 'running');

    // Reset the failure streak so a stopped run doesn't immediately re-stop.
    await batchService.updateRun(run.id, {
      status: hasRunningSibling ? 'queued' : 'running',
      ...(hasRunningSibling ? {} : { nextReleaseAt: new Date().toISOString() }),
      consecutiveFailures: 0,
    });

    logInfo(hasRunningSibling ? 'Batch run resume queued behind running run' : 'Batch run resumed', { runId: run.id, from: run.status });
    res.json({ run: await batchService.getRun(run.id) });
  } catch (error) {
    next(error);
  }
});

// ─── POST /:id/runs/:runId/cancel — Cancel queue (and launched) ──

router.post('/:id/runs/:runId/cancel', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { scope } = BatchCancelInput.parse(req.body);
    const processor = await loadProcessor(req);
    const run = await loadRun(processor, req.params.runId as string);

    if (run.status === 'completed' || run.status === 'cancelled') {
      throw new ValidationError(`The run is already ${run.status}.`);
    }

    // A queued run is cancelled status-first (conditionally), so the
    // dispatcher's promotion can never grab it mid-cancel and start
    // launching rows we are about to flip.
    if (run.status === 'queued') {
      const claimed = await batchService.claimQueuedRunForCancel(run.id);
      if (!claimed) {
        throw new ValidationError('The run just started - reload and cancel it as a running run.');
      }
    }

    const now = new Date().toISOString();
    const rows = await batchService.getRowsByRun(run.id);

    // Queued/staged rows → cancelled
    let cancelledRows = 0;
    for (const row of rows) {
      if (row.status === 'queued' || row.status === 'staged') {
        const ok = await batchService.updateRow(
          run.id, row.rowNumber,
          { status: 'cancelled', completedAt: now },
          ['queued', 'staged'],
        );
        if (ok) cancelledRows++;
      }
    }

    // Scope 'all': also cancel launched instances that are not terminal yet,
    // via the same logic as POST /api/instances/:id/cancel (shared service).
    let cancelledInstances = 0;
    if (scope === 'all') {
      const launched = rows.filter((r) => r.status === 'launched');
      const resolved = await batchService.resolveRowInstanceStatuses(launched);
      for (const r of resolved) {
        if (r.status === 'launched' && r.instance && !TERMINAL_INSTANCE_STATUSES.has(r.instance.status)) {
          await cancelWorkflowInstance(r.instance);
          await batchService.updateRow(run.id, r.rowNumber, { status: 'cancelled', completedAt: now }, ['launched']);
          cancelledInstances++;
        }
      }
    }

    // Run → cancelled when nothing is left to process
    const after = await batchService.getRowsByRun(run.id);
    const launchedAfter = after.filter((r) => r.status === 'launched');
    const resolvedAfter = await batchService.resolveRowInstanceStatuses(launchedAfter);
    const hasActive =
      after.some((r) => r.status === 'queued' || r.status === 'launching') ||
      resolvedAfter.some((r) => r.status === 'launched' && r.instance && !TERMINAL_INSTANCE_STATUSES.has(r.instance.status));
    if (!hasActive) {
      await batchService.updateRun(run.id, { status: 'cancelled', completedAt: now });
    }

    logInfo('Batch run cancel requested', { runId: run.id, scope, cancelledRows, cancelledInstances });
    logAudit({
      orgId: processor.orgId,
      userId: req.auth!.userId,
      action: 'batch.run_cancelled',
      resourceType: 'batch',
      resourceId: run.id,
      metadata: { fileName: run.fileName, scope, cancelledRows, cancelledInstances },
    });

    res.json({ run: await batchService.getRun(run.id), cancelledRows, cancelledInstances });
  } catch (error) {
    next(error);
  }
});

// ─── POST /:id/runs/:runId/rows/:rowNumber/cancel — Cancel one row ──

router.post('/:id/runs/:runId/rows/:rowNumber/cancel', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const processor = await loadProcessor(req);
    const run = await loadRun(processor, req.params.runId as string);

    const rowNumber = parseInt(req.params.rowNumber as string, 10);
    if (!Number.isInteger(rowNumber) || rowNumber < 1) {
      throw new ValidationError('rowNumber must be a positive integer');
    }

    const row = await batchService.getRow(run.id, rowNumber);
    if (!row) throw new NotFoundError('Row');

    const now = new Date().toISOString();

    if (row.status === 'queued' || row.status === 'staged') {
      await batchService.updateRow(run.id, rowNumber, { status: 'cancelled', completedAt: now }, ['queued', 'staged']);
    } else if (row.status === 'launched') {
      if (row.workflowInstanceId) {
        const docClient = getDocClient();
        const result = await docClient.send(new GetCommand({
          TableName: TableNames.WORKFLOW_INSTANCES,
          Key: { id: row.workflowInstanceId },
        }));
        const instance = result.Item as WorkflowInstance | undefined;
        if (instance && TERMINAL_INSTANCE_STATUSES.has(instance.status)) {
          throw new ValidationError('The workflow for this row already finished - refresh to see its final status.');
        }
        if (instance) {
          await cancelWorkflowInstance(instance);
        }
      }
      await batchService.updateRow(run.id, rowNumber, { status: 'cancelled', completedAt: now }, ['launched']);
    } else if (row.status === 'launching') {
      throw new ValidationError('The row is being launched right now - try again in a moment.');
    } else {
      throw new ValidationError(`A ${row.status} row cannot be cancelled.`);
    }

    logInfo('Batch row cancelled', { runId: run.id, rowNumber });
    res.json({ message: 'Row cancelled', rowNumber });
  } catch (error) {
    next(error);
  }
});

export default router;
