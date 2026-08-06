/**
 * Automations Routes — Baton
 * Automation CRUD + pause/resume + history
 *
 * Wired to: rule-engine.service
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  CreateAutomationInput,
  UpdateAutomationInput,
  PreflightInput,
} from '../docs/schemas/automation';
import { requireMember, requireViewer } from '../middleware/rbac';
import { NotFoundError, ValidationError } from '../middleware/error-handler';
import { logInfo } from '../lib/logger';
import { QueryCommand, UpdateCommand, BatchGetCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import * as ruleEngine from '../services/rule-engine.service';
import { hasConnector, getConnector } from '../services/connectors';
import { AutomationRule, Platform, TriggerPipelineEntry, WorkflowInstance, WebhookEvent } from '../lib/types';
import { logAudit } from '../services/audit.service';
import { removeFlowPositions } from '../services/flow-layout.service';
import { createBootstrapToken } from '../services/bootstrap-token.service'; // used by /preflight for SF
import env from '../env';
import crypto from 'crypto';

const router = Router();

/** Build per-automation webhook URL from the rule's webhookKey */
function ruleWebhookUrl(rule: AutomationRule): string | undefined {
  if (!rule.webhookKey) return undefined;
  return `${env.APP_URL}/api/webhooks/rule/${rule.webhookKey}`;
}

/** Enrich a rule with its webhookUrl for API responses */
function withWebhookUrl(rule: AutomationRule): AutomationRule & { webhookUrl?: string } {
  return { ...rule, webhookUrl: ruleWebhookUrl(rule) };
}
router.use(requireAuth);

// Validation schemas live in src/docs/schemas/automation.ts.

// ─── POST /api/automations/preflight — Pre-generate webhook URL ──────────

router.post('/preflight', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sourcePlatform } = PreflightInput.parse(req.body || {});
    const orgId = req.auth!.orgId;
    const webhookKey = crypto.randomBytes(32).toString('hex');
    let webhookUrl = `${env.APP_URL}/api/webhooks/rule/${webhookKey}`;

    // For Salesforce: issue a bootstrap token alongside the webhookKey so the
    // URL is immediately ready to paste into Flow Builder (no secret entry).
    // The token is bound to webhookKey only — no rule exists yet at this stage,
    // and the redemption endpoint will validate rule existence at exchange time.
    // If the customer abandons the form, the orphan token TTLs out in 24h.
    if (sourcePlatform === 'salesforce') {
      try {
        const { tokenId } = await createBootstrapToken({ webhookKey, orgId });
        webhookUrl = `${webhookUrl}?bootstrap=${encodeURIComponent(tokenId)}`;
      } catch (e: any) {
        logInfo('Bootstrap token issuance skipped at preflight (non-fatal)', {
          orgId,
          error: e.message,
        });
      }
    }

    res.json({ webhookKey, webhookUrl });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/automations — List automations for org ─────────────────────

router.get('/', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const rules = await ruleEngine.getRulesByOrg(orgId);

    // Filter out soft-deleted
    const activeRules = rules.filter((r) => r.status !== 'disabled');

    res.json({ automations: activeRules.map(withWebhookUrl) });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/automations/event-types/:platform — Available events ─

router.get('/event-types/:platform', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const platform = req.params.platform as Platform;
    if (!hasConnector(platform)) {
      throw new ValidationError(`Platform '${platform}' is not supported`);
    }
    const connector = getConnector(platform);
    const eventTypes = connector.getSupportedEventTypes();
    res.json({ eventTypes });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/automations/:id — Get automation details ───────────────────

router.get('/:id', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId || rule.status === 'disabled') {
      throw new NotFoundError('Automation');
    }
    res.json({ automation: withWebhookUrl(rule) });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/automations — Create automation ──────────────────────────

router.post('/', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateAutomationInput.parse(req.body);
    const orgId = req.auth!.orgId;

    const rule = await ruleEngine.createRule({
      ...data,
      appId: data.appId,
      orgId,
      webhookKey: data.webhookKey,
      createdBy: req.auth!.userId,
    });

    logInfo('Automation created via API', { ruleId: rule.id, orgId });

    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'automation.created',
      resourceType: 'automation',
      resourceId: rule.id,
      metadata: { name: data.name, sourcePlatform: data.sourcePlatform, eventType: data.eventType },
    });

    // Bootstrap token issuance for Salesforce rules lives at /api/automations/preflight
    // (preflight is the canonical source — it issues the token bound to the webhookKey
    // BEFORE rule creation so the admin sees the enriched URL while composing the form).
    // API consumers who skip preflight can issue tokens explicitly via
    // POST /api/salesforce/bootstrap-tokens.
    res.status(201).json({ automation: withWebhookUrl(rule) });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/automations/:id — Update automation ─────────────────────

router.patch('/:id', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = UpdateAutomationInput.parse(req.body);
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId || rule.status === 'disabled') {
      throw new NotFoundError('Automation');
    }

    // Build DynamoDB update expression
    const docClient = getDocClient();
    const updateExprs: string[] = ['updatedAt = :now'];
    const exprValues: Record<string, any> = { ':now': new Date().toISOString() };
    const exprNames: Record<string, string> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const safeKey = key === 'name' ? '#n' : key;
        if (key === 'name') exprNames['#n'] = 'name';
        updateExprs.push(`${safeKey} = :${key}`);
        exprValues[`:${key}`] = value;
      }
    }

    await docClient.send(new UpdateCommand({
      TableName: TableNames.AUTOMATION_RULES,
      Key: { id: req.params.id as string },
      UpdateExpression: `SET ${updateExprs.join(', ')}`,
      ExpressionAttributeValues: exprValues,
      ...(Object.keys(exprNames).length > 0 ? { ExpressionAttributeNames: exprNames } : {}),
    }));

    const updated = await ruleEngine.getRule(req.params.id as string);

    logAudit({
      orgId: req.auth!.orgId,
      userId: req.auth!.userId,
      action: 'automation.updated',
      resourceType: 'automation',
      resourceId: req.params.id as string,
      metadata: { updatedFields: Object.keys(updates) },
    });

    res.json({ automation: updated ? withWebhookUrl(updated) : updated });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /api/automations/:id — Soft-delete automation ────────────────

router.delete('/:id', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId) throw new NotFoundError('Automation');

    await ruleEngine.deleteRule(req.params.id as string);
    await removeFlowPositions(req.auth!.orgId, [`pair-${req.params.id}`]);

    logInfo('Automation deleted via API', { ruleId: req.params.id });

    logAudit({
      orgId: req.auth!.orgId,
      userId: req.auth!.userId,
      action: 'automation.deleted',
      resourceType: 'automation',
      resourceId: req.params.id as string,
      metadata: { name: rule.name },
    });

    res.json({ message: 'Automation removed', id: req.params.id });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/automations/:id/pause — Pause automation ─────────────────

router.post('/:id/pause', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId) throw new NotFoundError('Automation');

    await ruleEngine.updateRuleStatus(req.params.id as string, 'paused');

    logInfo('Automation paused', { ruleId: req.params.id });

    logAudit({
      orgId: req.auth!.orgId,
      userId: req.auth!.userId,
      action: 'automation.paused',
      resourceType: 'automation',
      resourceId: req.params.id as string,
      metadata: { name: rule.name },
    });

    res.json({ message: 'Automation paused', id: req.params.id, status: 'paused' });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/automations/:id/resume — Resume automation ───────────────

router.post('/:id/resume', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId) throw new NotFoundError('Automation');

    await ruleEngine.updateRuleStatus(req.params.id as string, 'active');

    // Release all queued webhooks accumulated while paused
    const queuedItems = await ruleEngine.getQueuedWebhooks(req.params.id as string);
    const activeRule = { ...rule, status: 'active' as const };
    for (const item of queuedItems) {
      await ruleEngine.releaseQueuedWebhook(item, activeRule, (req as any).requestId);
    }

    logInfo('Automation resumed', { ruleId: req.params.id, released: queuedItems.length });

    logAudit({
      orgId: req.auth!.orgId,
      userId: req.auth!.userId,
      action: 'automation.resumed',
      resourceType: 'automation',
      resourceId: req.params.id as string,
      metadata: { name: rule.name, released: queuedItems.length },
    });

    res.json({ message: 'Automation resumed', id: req.params.id, status: 'active', released: queuedItems.length });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/automations/:id/queue — List queued webhooks ──────────────

router.get('/:id/queue', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId) throw new NotFoundError('Automation');

    const items = await ruleEngine.getQueuedWebhooks(req.params.id as string);
    res.json({ items, count: items.length });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/automations/:id/queue/:itemId/release — Let through one ──

router.post('/:id/queue/:itemId/release', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId) throw new NotFoundError('Automation');

    const items = await ruleEngine.getQueuedWebhooks(req.params.id as string);
    const item = items.find((i) => i.id === req.params.itemId);
    if (!item) throw new NotFoundError('Queued webhook');

    await ruleEngine.releaseQueuedWebhook(item, rule, (req as any).requestId);
    res.json({ message: 'Webhook released' });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /api/automations/:id/queue/:itemId — Cancel one item ─────────

router.delete('/:id/queue/:itemId', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId) throw new NotFoundError('Automation');

    await ruleEngine.cancelQueuedWebhook(req.params.itemId as string);
    res.json({ message: 'Webhook cancelled' });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/automations/:id/history — Automation trigger history ──────

router.get('/:id/history', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId) throw new NotFoundError('Automation');

    const docClient = getDocClient();
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.TRIGGER_PIPELINE,
      IndexName: 'ruleId-triggeredAt-index',
      KeyConditionExpression: 'ruleId = :ruleId',
      ExpressionAttributeValues: { ':ruleId': req.params.id },
      ScanIndexForward: false, // Newest first
      Limit: parseInt(req.query.limit as string) || 50,
    }));

    res.json({ history: result.Items || [] });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/automations/:id/webhooks — Raw webhook events for this automation ──

router.get('/:id/webhooks', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId) throw new NotFoundError('Automation');

    const docClient = getDocClient();
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.WEBHOOK_EVENTS,
      IndexName: 'platform-receivedAt-index',
      KeyConditionExpression: 'platform = :platform',
      FilterExpression: 'connectionId = :connectionId',
      ExpressionAttributeValues: {
        ':platform': rule.sourcePlatform,
        ':connectionId': rule.connectionId || rule.appId || '',
      },
      ScanIndexForward: false,
      Limit: limit * 3, // Overscan since FilterExpression reduces results
    }));

    const webhooks = (result.Items || []).slice(0, limit);
    res.json({ webhooks });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/automations/:id/actions — Unified action list ──────────────────
// Joins rule_match pipeline entries with webhook events + instances in one response.

router.get('/:id/actions', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await ruleEngine.getRule(req.params.id as string);
    if (!rule || rule.orgId !== req.auth!.orgId || rule.status === 'disabled') {
      throw new NotFoundError('Automation');
    }

    const docClient = getDocClient();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    // 1. Fetch rule_match pipeline entries (newest first)
    const pipelineResult = await docClient.send(new QueryCommand({
      TableName: TableNames.TRIGGER_PIPELINE,
      IndexName: 'ruleId-triggeredAt-index',
      KeyConditionExpression: 'ruleId = :ruleId',
      FilterExpression: 'eventType = :et',
      ExpressionAttributeValues: {
        ':ruleId': req.params.id,
        ':et': 'rule_match',
      },
      ScanIndexForward: false,
      Limit: limit * 3, // overscan for filter
    }));

    const entries = ((pipelineResult.Items || []) as TriggerPipelineEntry[]).slice(0, limit);

    // 2. BatchGet webhook events
    const webhookIds = [...new Set(entries.map((e) => e.webhookEventId).filter(Boolean))] as string[];
    const webhookMap = new Map<string, WebhookEvent>();
    if (webhookIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < webhookIds.length; i += 100) chunks.push(webhookIds.slice(i, i + 100));
      for (const chunk of chunks) {
        const batchResult = await docClient.send(new BatchGetCommand({
          RequestItems: {
            [TableNames.WEBHOOK_EVENTS]: {
              Keys: chunk.map((id) => ({ id })),
            },
          },
        }));
        const items = (batchResult.Responses?.[TableNames.WEBHOOK_EVENTS] || []) as WebhookEvent[];
        for (const item of items) webhookMap.set(item.id, item);
      }
    }

    // 3. BatchGet instances
    const instanceIds = [...new Set(entries.map((e) => e.workflowInstanceId).filter(Boolean))] as string[];
    const instanceMap = new Map<string, WorkflowInstance>();
    if (instanceIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < instanceIds.length; i += 100) chunks.push(instanceIds.slice(i, i + 100));
      for (const chunk of chunks) {
        const batchResult = await docClient.send(new BatchGetCommand({
          RequestItems: {
            [TableNames.WORKFLOW_INSTANCES]: {
              Keys: chunk.map((id) => ({ id })),
            },
          },
        }));
        const items = (batchResult.Responses?.[TableNames.WORKFLOW_INSTANCES] || []) as WorkflowInstance[];
        for (const item of items) instanceMap.set(item.id, item);
      }
    }

    // 4. Build ActionItem response
    const actions = entries.map((entry) => {
      const webhook = entry.webhookEventId ? webhookMap.get(entry.webhookEventId) : undefined;
      const instance = entry.workflowInstanceId ? instanceMap.get(entry.workflowInstanceId) : undefined;

      // Derive action status — Action is responsible only for triggering the workflow,
      // not for its execution. "launched" = workflow was triggered successfully.
      let status: 'launched' | 'running' | 'failed';
      if (webhook && webhook.signatureValid === false) {
        status = 'failed';
      } else if (!instance) {
        status = entry.status === 'failed' ? 'failed' : 'running';
      } else {
        // Instance exists = workflow was triggered successfully
        status = 'launched';
      }

      return {
        actionNumber: entry.actionNumber ?? null,
        pipelineEntryId: entry.id,
        webhookEventId: entry.webhookEventId ?? null,
        triggeredAt: entry.triggeredAt,
        status,
        signatureValid: webhook?.signatureValid ?? null,
        payload: entry.rawPayload ?? {},
        errorMessage: entry.errorMessage ?? instance?.errorMessage ?? null,
        userMessage: entry.userMessage ?? null,
        instance: instance ? {
          id: instance.id,
          maestroInstanceId: instance.maestroInstanceId ?? null,
          status: instance.status,
          retryCount: instance.retryCount ?? 0,
          retryMaxAttempts: instance.retryMaxAttempts ?? null,
          nextRetryAt: instance.nextRetryAt ?? null,
          errorMessage: instance.errorMessage ?? null,
          inputData: instance.inputData ?? null,
        } : null,
      };
    });

    res.json({ actions });
  } catch (error) {
    next(error);
  }
});

export default router;
