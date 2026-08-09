/**
 * Workflow Routes — Baton
 * Manage Maestro workflow sync, CRUD, manual launch, instance tracking
 * 
 * Wired to: maestro.service, connection.service
 */
import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { requireAdmin, requireMember, requireViewer } from '../middleware/rbac';
import { NotFoundError, ValidationError } from '../middleware/error-handler';
import { logInfo, logError } from '../lib/logger';
import { Workflow, WorkflowInstance } from '../lib/types';
import * as maestroService from '../services/maestro.service';
import * as connectionService from '../services/connection.service';
import { logAudit } from '../services/audit.service';
import { countCompletionIfNeeded } from '../services/usage.service';
import { sendMessage, QueueNames } from '../queue/sqs-client';
import type { NotificationJob } from '../workers/notification-sender.worker';
import env from '../env';
import {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  SyncWorkflowsInput,
  LaunchWorkflowInput,
} from '../docs/schemas/workflow';

const router = Router();

// Per-org timestamp of last Maestro schema check — rate-limits background calls to once per 5 min
const lastAutoSyncCheck = new Map<string, number>();
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

async function autoSyncChangedWorkflows(orgId: string, localWorkflows: Workflow[]): Promise<void> {
  const now = Date.now();
  if ((now - (lastAutoSyncCheck.get(orgId) ?? 0)) < AUTO_SYNC_INTERVAL_MS) return;
  lastAutoSyncCheck.set(orgId, now);

  const connection = await connectionService.getConnectionByOrgAndPlatform(orgId, 'docusign');
  if (!connection) return;

  const maestroWorkflows = await maestroService.listWorkflows(connection.id, 'all');
  const docClient = getDocClient();
  const nowIso = new Date().toISOString();

  for (const mw of maestroWorkflows) {
    const local = localWorkflows.find((w) => w.maestroWorkflowId === mw.id);
    if (!local) continue;
    // Skip only when Maestro returns updatedAt and we already have that version stored
    if (mw.updatedAt && local.maestroUpdatedAt && local.maestroUpdatedAt >= mw.updatedAt) continue;

    try {
      const triggerReqs = await maestroService.getTriggerRequirements(connection.id, mw.id);
      const updateExpr = 'SET maestroUpdatedAt = :mUpdatedAt, updatedAt = :now'
        + (triggerReqs.triggerInputSchema ? ', triggerInputSchema = :schema, triggerType = :triggerType' : '');
      const exprValues: Record<string, any> = { ':mUpdatedAt': mw.updatedAt ?? nowIso, ':now': nowIso };
      if (triggerReqs.triggerInputSchema) {
        exprValues[':schema'] = triggerReqs.triggerInputSchema;
        exprValues[':triggerType'] = triggerReqs.triggerEventType || 'http';
      }
      await docClient.send(new UpdateCommand({
        TableName: TableNames.WORKFLOWS,
        Key: { id: local.id },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: exprValues,
      }));
      logInfo('Auto-synced workflow schema', { workflowId: local.id, maestroUpdatedAt: mw.updatedAt });
    } catch {
      // Non-critical — skip this workflow
    }
  }
}

function getMaestroAppsBase(): string {
  // Convert API base (api-d.docusign.com) to apps base (apps-d.docusign.com)
  return env.DOCUSIGN_MAESTRO_API_BASE.replace('api-d', 'apps-d').replace('api.', 'apps.');
}

function getMaestroWorkflowUrl(maestroWorkflowId: string): string {
  return `${getMaestroAppsBase()}/send/workflows/${maestroWorkflowId}/edit?preview=false`;
}

function getMaestroInstancesUrl(maestroWorkflowId: string): string {
  return `${getMaestroAppsBase()}/send/workflows/${maestroWorkflowId}`;
}
router.use(requireAuth);

// Validation schemas live in src/docs/schemas/workflow.ts (single source of truth: docs + parse).

// ─── GET /api/workflows — List workflows for org ─────────────

router.get('/', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.WORKFLOWS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));

    const workflows = (result.Items as Workflow[]) || [];
    const enriched = workflows.map((wf) => ({
      ...wf,
      maestroUrl: wf.maestroWorkflowId
        ? getMaestroWorkflowUrl(wf.maestroWorkflowId)
        : undefined,
      maestroInstancesUrl: wf.maestroWorkflowId
        ? getMaestroInstancesUrl(wf.maestroWorkflowId)
        : undefined,
    }));
    res.json({ workflows: enriched });

    // Fire background schema check — non-blocking, max once per 5 min per org
    autoSyncChangedWorkflows(orgId, workflows).catch(() => {});
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/workflows/:id — Get workflow details ───────────

router.get('/:id', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workflow = await getWorkflowById(req.params.id as string);
    if (!workflow || workflow.orgId !== req.auth!.orgId) throw new NotFoundError('Workflow');

    res.json({ workflow });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/workflows — Create workflow manually ──────────

router.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateWorkflowInput.parse(req.body);
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    // If connectionId provided, verify it belongs to org
    if (data.connectionId) {
      const conn = await connectionService.getConnection(data.connectionId);
      if (!conn || conn.orgId !== orgId) throw new ValidationError('Connection not found or does not belong to this organization');
    }

    const now = new Date().toISOString();
    const workflow: Workflow = {
      id: uuidv4(),
      orgId,
      name: data.name,
      description: data.description,
      maestroWorkflowId: data.maestroWorkflowId,
      maestroStatus: 'draft',
      triggerType: 'http',
      triggerInputSchema: data.triggerInputSchema,
      stepCount: 0,
      platform: 'docusign',
      connectionId: data.connectionId,
      tags: data.tags,
      launchCount: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: req.auth!.userId,
    };

    await docClient.send(new PutCommand({
      TableName: TableNames.WORKFLOWS,
      Item: workflow,
    }));

    logInfo('Workflow created', { workflowId: workflow.id, orgId });

    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'workflow.created',
      resourceType: 'workflow',
      resourceId: workflow.id,
      metadata: { name: data.name },
    });

    res.status(201).json({ workflow });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/workflows/:id — Update workflow ──────────────

router.patch('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = UpdateWorkflowInput.parse(req.body);
    const orgId = req.auth!.orgId;

    const workflow = await getWorkflowById(req.params.id as string);
    if (!workflow || workflow.orgId !== orgId) throw new NotFoundError('Workflow');

    // If changing connection, verify it belongs to org
    if (data.connectionId) {
      const conn = await connectionService.getConnection(data.connectionId);
      if (!conn || conn.orgId !== orgId) throw new ValidationError('Connection not found or does not belong to this organization');
    }

    const docClient = getDocClient();
    const updates: string[] = ['updatedAt = :now'];
    const values: Record<string, any> = { ':now': new Date().toISOString() };
    const names: Record<string, string> = {};

    if (data.name !== undefined) { updates.push('#n = :name'); values[':name'] = data.name; names['#n'] = 'name'; }
    if (data.description !== undefined) { updates.push('description = :desc'); values[':desc'] = data.description; }
    if (data.connectionId !== undefined) { updates.push('connectionId = :connId'); values[':connId'] = data.connectionId; }
    if (data.triggerInputSchema !== undefined) { updates.push('triggerInputSchema = :schema'); values[':schema'] = data.triggerInputSchema; }
    if (data.tags !== undefined) { updates.push('tags = :tags'); values[':tags'] = data.tags; }

    await docClient.send(new UpdateCommand({
      TableName: TableNames.WORKFLOWS,
      Key: { id: workflow.id },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
    }));

    logInfo('Workflow updated', { workflowId: workflow.id, orgId });

    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'workflow.updated',
      resourceType: 'workflow',
      resourceId: workflow.id,
      metadata: data,
    });

    res.json({ message: 'Workflow updated', id: workflow.id });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/workflows/sync — Sync workflows from Maestro ─

router.post('/sync', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { connectionId: explicitConnectionId } = SyncWorkflowsInput.parse(req.body);
    const orgId = req.auth!.orgId;

    let connectionId: string;

    if (explicitConnectionId) {
      // Verify connection belongs to org and is DocuSign
      const connection = await connectionService.getConnection(explicitConnectionId);
      if (!connection || connection.orgId !== orgId) throw new NotFoundError('Connection');
      if (connection.platform !== 'docusign') throw new ValidationError('Can only sync workflows from a DocuSign connection');
      connectionId = explicitConnectionId;
    } else {
      // Auto-detect DocuSign connection for this org
      const connection = await connectionService.getConnectionByOrgAndPlatform(orgId, 'docusign');
      if (!connection) throw new NotFoundError('No DocuSign connection found for this organization');
      connectionId = connection.id;
    }

    // Fetch workflows from Maestro API
    const maestroWorkflows = await maestroService.listWorkflows(connectionId, 'all');

    const docClient = getDocClient();
    const synced: Workflow[] = [];
    const now = new Date().toISOString();

    for (const mw of maestroWorkflows) {
      // Check if workflow already exists for this org
      const existing = await findWorkflowByMaestroId(orgId, mw.id);

      if (existing) {
        // Update existing — name, status, connectionId only (use per-workflow sync for trigger schema)
        const existingUpdateExpr = 'SET #n = :name, maestroStatus = :status, updatedAt = :now, connectionId = :connId'
          + (mw.updatedAt ? ', maestroUpdatedAt = :mUpdatedAt' : '');
        const existingExprValues: Record<string, any> = {
          ':name': mw.name,
          ':status': mw.status === 'active' ? 'active' : mw.status === 'paused' ? 'paused' : 'draft',
          ':now': now,
          ':connId': connectionId,
        };
        if (mw.updatedAt) existingExprValues[':mUpdatedAt'] = mw.updatedAt;
        await docClient.send(new UpdateCommand({
          TableName: TableNames.WORKFLOWS,
          Key: { id: existing.id },
          UpdateExpression: existingUpdateExpr,
          ExpressionAttributeValues: existingExprValues,
          ExpressionAttributeNames: { '#n': 'name' },
        }));
        synced.push({
          ...existing,
          name: mw.name,
          maestroStatus: mw.status as any,
        });
      } else {
        // Fetch trigger requirements only for NEW workflows
        let triggerReqs: any = {};
        try {
          triggerReqs = await maestroService.getTriggerRequirements(connectionId, mw.id);
        } catch {
          // Some workflows may not have trigger requirements
        }

        // Create new
        const workflow: Workflow = {
          id: uuidv4(),
          orgId,
          name: mw.name,
          description: mw.description,
          maestroWorkflowId: mw.id,
          maestroStatus: mw.status === 'active' ? 'active' : mw.status === 'paused' ? 'paused' : 'draft',
          triggerType: (triggerReqs.triggerEventType || 'http') as any,
          triggerInputSchema: triggerReqs.triggerInputSchema,
          stepCount: mw.stepCount || 0,
          platform: 'docusign',
          connectionId,
          launchCount: 0,
          createdAt: now,
          updatedAt: now,
          maestroUpdatedAt: mw.updatedAt,
          createdBy: req.auth!.userId,
        };

        await docClient.send(new PutCommand({
          TableName: TableNames.WORKFLOWS,
          Item: workflow,
        }));
        synced.push(workflow);
      }
    }

    // Delete local workflows for this connection that no longer exist in Maestro
    const maestroIds = new Set(maestroWorkflows.map((mw) => mw.id));
    const existingResult = await docClient.send(new QueryCommand({
      TableName: TableNames.WORKFLOWS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      FilterExpression: 'connectionId = :connId AND attribute_exists(maestroWorkflowId)',
      ExpressionAttributeValues: { ':orgId': orgId, ':connId': connectionId },
    }));
    const toDelete = (existingResult.Items || []).filter(
      (wf: any) => wf.maestroWorkflowId && !maestroIds.has(wf.maestroWorkflowId),
    );
    await Promise.all(toDelete.map((wf: any) =>
      docClient.send(new DeleteCommand({ TableName: TableNames.WORKFLOWS, Key: { id: wf.id } })),
    ));
    if (toDelete.length > 0) {
      logInfo('Orphaned workflows removed after sync', { orgId, connectionId, count: toDelete.length });
    }

    logInfo('Workflows synced from Workflow Builder', { orgId, connectionId, count: synced.length });

    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'workflow.synced',
      resourceType: 'workflow',
      resourceId: connectionId,
      metadata: { connectionId, syncedCount: synced.length },
    });

    // No notification here on purpose: a successful sync is a routine
    // confirmation - the workflows page and the sync toast already show it.
    res.json({ workflows: synced, syncedCount: synced.length });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/workflows/:id/sync — Sync single workflow from Maestro ─

router.post('/:id/sync', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const workflow = await getWorkflowById(req.params.id as string);
    if (!workflow || workflow.orgId !== orgId) throw new NotFoundError('Workflow');
    if (!workflow.maestroWorkflowId) throw new ValidationError('Workflow has no Workflow Builder ID');

    // Find DocuSign connection
    let dsConnId = workflow.connectionId;
    if (dsConnId) {
      const conn = await connectionService.getConnection(dsConnId);
      if (!conn || conn.platform !== 'docusign') dsConnId = undefined;
    }
    if (!dsConnId) {
      const orgConns = await connectionService.getConnectionsByOrg(orgId);
      dsConnId = orgConns.find((c) => c.platform === 'docusign' && c.status === 'healthy')?.id;
    }
    if (!dsConnId) throw new ValidationError('No healthy DocuSign connection found');

    // Fetch trigger requirements from Maestro
    const triggerReqs = await maestroService.getTriggerRequirements(dsConnId, workflow.maestroWorkflowId);

    const now = new Date().toISOString();
    const docClient = getDocClient();

    const updateExpr = 'SET updatedAt = :now, connectionId = :connId'
      + (triggerReqs.triggerInputSchema ? ', triggerInputSchema = :schema, triggerType = :triggerType' : '');
    const exprValues: Record<string, any> = {
      ':now': now,
      ':connId': dsConnId,
    };
    if (triggerReqs.triggerInputSchema) {
      exprValues[':schema'] = triggerReqs.triggerInputSchema;
      exprValues[':triggerType'] = triggerReqs.triggerEventType || 'http';
    }

    await docClient.send(new UpdateCommand({
      TableName: TableNames.WORKFLOWS,
      Key: { id: workflow.id },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: exprValues,
    }));

    logInfo('Single workflow synced', { workflowId: workflow.id, maestroId: workflow.maestroWorkflowId });

    res.json({
      message: 'Workflow synced',
      triggerInputSchema: triggerReqs.triggerInputSchema,
      triggerType: triggerReqs.triggerEventType,
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/workflows/:id/launch — Manual launch ─────────

router.post('/:id/launch', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { instanceName, triggerInputs } = LaunchWorkflowInput.parse(req.body);
    const orgId = req.auth!.orgId;

    const workflow = await getWorkflowById(req.params.id as string);
    if (!workflow || workflow.orgId !== orgId) throw new NotFoundError('Workflow');
    if (!workflow.maestroWorkflowId) throw new ValidationError('Workflow has no Workflow Builder ID');

    // Resolve DocuSign connection: use workflow's connectionId if it's a valid DocuSign connection,
    // otherwise find a healthy DocuSign connection for this org
    let dsConnectionId = workflow.connectionId;
    if (dsConnectionId) {
      const conn = await connectionService.getConnection(dsConnectionId);
      if (!conn || conn.platform !== 'docusign') {
        dsConnectionId = undefined;
      }
    }
    if (!dsConnectionId) {
      const orgConnections = await connectionService.getConnectionsByOrg(orgId);
      const dsConn = orgConnections.find((c) => c.platform === 'docusign' && c.status === 'healthy');
      if (!dsConn) throw new ValidationError('No healthy DocuSign connection found. Please reconnect DocuSign.');
      dsConnectionId = dsConn.id;
    }

    // Launch via Maestro
    const result = await maestroService.launchWorkflow({
      connectionId: dsConnectionId,
      workflowId: workflow.maestroWorkflowId,
      instanceName,
      triggerInputs,
    });

    // Create instance record
    const now = new Date().toISOString();
    const instance: WorkflowInstance = {
      id: uuidv4(),
      orgId,
      workflowId: workflow.id,
      maestroInstanceId: result.instanceId,
      instanceName,
      status: 'running',
      inputData: triggerInputs,
      startedAt: now,
      retryCount: 0,
      launchedBy: req.auth!.userId,
      instanceUrl: result.instanceUrl,
    };

    const docClient = getDocClient();
    await docClient.send(new PutCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      Item: instance,
    }));

    // Update workflow stats
    await docClient.send(new UpdateCommand({
      TableName: TableNames.WORKFLOWS,
      Key: { id: workflow.id },
      UpdateExpression: 'SET launchCount = launchCount + :inc, lastLaunchedAt = :now, updatedAt = :now',
      ExpressionAttributeValues: { ':inc': 1, ':now': now },
    }));

    logInfo('Workflow launched manually', { workflowId: workflow.id, instanceId: result.instanceId });

    // No launch notification on purpose: the user just clicked the button and
    // sees the result; the Activity Log records it.
    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'workflow.launched',
      resourceType: 'workflow',
      resourceId: workflow.id,
      metadata: { instanceId: instance.id, maestroInstanceId: result.instanceId, instanceName },
    });

    res.status(201).json({
      instance: { ...instance, instanceUrl: result.instanceUrl },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/workflows/:id/instances — List instances ───────

router.get('/:id/instances', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;

    const workflow = await getWorkflowById(req.params.id as string);
    if (!workflow || workflow.orgId !== orgId) throw new NotFoundError('Workflow');

    const docClient = getDocClient();
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      IndexName: 'workflowId-startedAt-index',
      KeyConditionExpression: 'workflowId = :wfId',
      ExpressionAttributeValues: { ':wfId': workflow.id },
      ScanIndexForward: false, // Newest first
      Limit: 50,
    }));

    // Optionally enrich with live Maestro data
    let instances = (result.Items as WorkflowInstance[]) || [];

    if (workflow.maestroWorkflowId && req.query.live === 'true') {
      // Resolve a valid DocuSign connection for Maestro API calls
      let dsConnId = workflow.connectionId;
      if (dsConnId) {
        const conn = await connectionService.getConnection(dsConnId);
        if (!conn || conn.platform !== 'docusign') dsConnId = undefined;
      }
      if (!dsConnId) {
        const orgConns = await connectionService.getConnectionsByOrg(orgId);
        dsConnId = orgConns.find((c) => c.platform === 'docusign' && c.status === 'healthy')?.id;
      }

      if (dsConnId) {
        try {
          const maestroInstances = await maestroService.getInstances(dsConnId, workflow.maestroWorkflowId);
          // Merge Maestro data with local records and persist status changes
          instances = await Promise.all(instances.map(async (inst) => {
            const maestro = maestroInstances.find((m) => m.id === inst.maestroInstanceId);
            if (maestro) {
              // A manual cancel (user clicked Cancel in Baton) takes precedence
              // over Maestro state. Maestro doesn't accept cancels for instances
              // that are already terminal (e.g. failed), so its stale 'failed'
              // status would otherwise reset our local 'cancelled' on every
              // live poll — making cancel appear to do nothing in the UI.
              const manualCancel = inst.status === 'cancelled' && !!inst.manuallyCancelledAt;

              const enriched = {
                ...inst,
                status: manualCancel ? inst.status : (maestro.status as any),
                currentStep: maestro.lastStep,
                lastCompletedStep: maestro.lastCompletedStep,
                lastCompletedStepName: maestro.lastCompletedStepName,
                totalSteps: maestro.totalSteps,
                instanceUrl: maestro.instanceUrl || inst.instanceUrl,
                completedAt: manualCancel ? inst.completedAt : (maestro.endDate || inst.completedAt),
              };
              // Persist terminal status back to DynamoDB so it stays correct even without live enrichment
              if (!manualCancel && maestro.status !== inst.status && ['completed', 'failed', 'cancelled'].includes(maestro.status)) {
                try {
                  await docClient.send(new UpdateCommand({
                    TableName: TableNames.WORKFLOW_INSTANCES,
                    Key: { id: inst.id },
                    UpdateExpression: 'SET #s = :status, completedAt = :completedAt, lastCompletedStep = :lastStep, lastCompletedStepName = :lastStepName, totalSteps = :totalSteps, instanceUrl = :url',
                    ExpressionAttributeNames: { '#s': 'status' },
                    ExpressionAttributeValues: {
                      ':status': maestro.status,
                      ':completedAt': maestro.endDate || new Date().toISOString(),
                      ':lastStep': maestro.lastCompletedStep ?? null,
                      ':lastStepName': maestro.lastCompletedStepName ?? null,
                      ':totalSteps': maestro.totalSteps ?? null,
                      ':url': maestro.instanceUrl || inst.instanceUrl || null,
                    },
                  }));
                  // Count successful completion (idempotent)
                  if (maestro.status === 'completed') {
                    await countCompletionIfNeeded(inst.id, inst.orgId);
                  }
                } catch {
                  // Non-critical — enrichment still works for this response
                }
              }
              return enriched;
            }
            return inst;
          }));
        } catch {
          // If Maestro fetch fails, return local data
        }
      }
    }

    res.json({ instances });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /api/workflows/:id — Remove workflow ─────────────

router.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workflow = await getWorkflowById(req.params.id as string);
    if (!workflow || workflow.orgId !== req.auth!.orgId) throw new NotFoundError('Workflow');

    const docClient = getDocClient();
    await docClient.send(new DeleteCommand({
      TableName: TableNames.WORKFLOWS,
      Key: { id: workflow.id },
    }));

    logInfo('Workflow deleted', { id: workflow.id });

    logAudit({
      orgId: req.auth!.orgId,
      userId: req.auth!.userId,
      action: 'workflow.deleted',
      resourceType: 'workflow',
      resourceId: workflow.id,
      metadata: { name: workflow.name },
    });

    res.json({ message: 'Workflow removed', id: workflow.id });
  } catch (error) {
    next(error);
  }
});

// ─── Helpers ─────────────────────────────────────────────────

async function getWorkflowById(id: string): Promise<Workflow | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.WORKFLOWS,
    Key: { id },
  }));
  return (result.Item as Workflow) || null;
}

async function findWorkflowByMaestroId(orgId: string, maestroWorkflowId: string): Promise<Workflow | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.WORKFLOWS,
    IndexName: 'orgId-index',
    KeyConditionExpression: 'orgId = :orgId',
    FilterExpression: 'maestroWorkflowId = :mwId',
    ExpressionAttributeValues: { ':orgId': orgId, ':mwId': maestroWorkflowId },
  }));
  return (result.Items?.[0] as Workflow) || null;
}

export default router;
