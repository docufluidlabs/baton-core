/**
 * Webhook Endpoints Routes — Baton
 * CRUD for custom webhook endpoints that directly launch Maestro workflows.
 *
 * Each endpoint generates a unique URL: POST /api/postwebhook/{orgId}/{endpointId}
 * Optional API key authentication, configurable payload field path for record ID extraction.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { CreateWebhookEndpointInput, UpdateWebhookEndpointInput } from '../docs/schemas/webhook-endpoint';
import { getDocClient, TableNames } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { requireAdmin, requireViewer } from '../middleware/rbac';
import { logInfo } from '../lib/logger';
import { logAudit } from '../services/audit.service';
import { ValidationError, NotFoundError } from '../middleware/error-handler';
import { WebhookEndpoint } from '../lib/types';
import env from '../env';

const router = Router();
router.use(requireAuth);

// ─── GET /api/webhook-endpoints — List org's endpoints ───────

router.get('/', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));

    const endpoints = (result.Items as WebhookEndpoint[] || []).map((ep) => ({
      ...ep,
      webhookUrl: `${env.APP_URL}/api/postwebhook/${orgId}/${ep.id}`,
      // Never expose apiKey in list responses
      apiKey: ep.apiKey ? '••••••••' : undefined,
    }));

    res.json({ endpoints });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/webhook-endpoints/:id — Get endpoint details ──

router.get('/:id', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    const result = await docClient.send(new GetCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      Key: { id: req.params.id },
    }));

    const ep = result.Item as WebhookEndpoint | undefined;
    if (!ep || ep.orgId !== orgId) {
      throw new NotFoundError('Webhook endpoint');
    }

    res.json({
      endpoint: {
        ...ep,
        webhookUrl: `${env.APP_URL}/api/postwebhook/${orgId}/${ep.id}`,
        // Mask API key — only show last 4 chars
        apiKey: ep.apiKey ? `••••${ep.apiKey.slice(-4)}` : undefined,
        hasApiKey: !!ep.apiKey,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/webhook-endpoints — Create endpoint ──────────

router.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateWebhookEndpointInput.parse(req.body);
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    // Verify the workflow exists and belongs to org
    const workflowResult = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOWS,
      Key: { id: data.workflowId },
    }));

    if (!workflowResult.Item || workflowResult.Item.orgId !== orgId) {
      throw new ValidationError('Workflow not found or does not belong to this organization');
    }

    // Generate API key if requested
    let apiKey = data.apiKey;
    if (data.generateApiKey && !apiKey) {
      apiKey = `baton_wh_${crypto.randomBytes(24).toString('hex')}`;
    }

    const now = new Date().toISOString();
    const endpoint: WebhookEndpoint = {
      id: uuidv4(),
      orgId,
      name: data.name,
      platform: data.platform,
      workflowId: data.workflowId,
      payloadFieldPath: data.payloadFieldPath,
      apiKey,
      rateLimitPerMinute: data.rateLimitPerMinute || 60,
      enabled: true,
      requestCount: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: req.auth!.userId,
    };

    await docClient.send(new PutCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      Item: endpoint,
    }));

    logInfo('Webhook endpoint created', { endpointId: endpoint.id, orgId, platform: data.platform });

    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'webhook_endpoint.created',
      resourceType: 'webhook_endpoint',
      resourceId: endpoint.id,
      metadata: { name: data.name, platform: data.platform, workflowId: data.workflowId },
    });

    res.status(201).json({
      endpoint: {
        ...endpoint,
        webhookUrl: `${env.APP_URL}/api/postwebhook/${orgId}/${endpoint.id}`,
        // Return full API key on creation only (user must save it)
        apiKey: endpoint.apiKey,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/webhook-endpoints/:id — Update endpoint ─────

router.patch('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = UpdateWebhookEndpointInput.parse(req.body);
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    // Verify endpoint exists and belongs to org
    const existing = await docClient.send(new GetCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      Key: { id: req.params.id },
    }));

    if (!existing.Item || existing.Item.orgId !== orgId) {
      throw new NotFoundError('Webhook endpoint');
    }

    // If changing workflow, verify it exists
    if (data.workflowId) {
      const wf = await docClient.send(new GetCommand({
        TableName: TableNames.WORKFLOWS,
        Key: { id: data.workflowId },
      }));
      if (!wf.Item || wf.Item.orgId !== orgId) {
        throw new ValidationError('Workflow not found or does not belong to this organization');
      }
    }

    // Generate API key if requested
    let apiKey = data.apiKey;
    if (data.generateApiKey) {
      apiKey = `baton_wh_${crypto.randomBytes(24).toString('hex')}`;
    }

    const updates: string[] = ['updatedAt = :now'];
    const values: Record<string, any> = { ':now': new Date().toISOString() };

    if (data.name !== undefined) { updates.push('#n = :name'); values[':name'] = data.name; }
    if (data.workflowId !== undefined) { updates.push('workflowId = :wfId'); values[':wfId'] = data.workflowId; }
    if (data.payloadFieldPath !== undefined) { updates.push('payloadFieldPath = :pfp'); values[':pfp'] = data.payloadFieldPath; }
    if (apiKey !== undefined) { updates.push('apiKey = :apiKey'); values[':apiKey'] = apiKey; }
    if (data.rateLimitPerMinute !== undefined) { updates.push('rateLimitPerMinute = :rlpm'); values[':rlpm'] = data.rateLimitPerMinute; }
    if (data.enabled !== undefined) { updates.push('enabled = :enabled'); values[':enabled'] = data.enabled; }

    const names: Record<string, string> = {};
    if (data.name !== undefined) names['#n'] = 'name';

    await docClient.send(new UpdateCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      Key: { id: req.params.id },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
    }));

    logInfo('Webhook endpoint updated', { endpointId: req.params.id, orgId });

    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'webhook_endpoint.updated',
      resourceType: 'webhook_endpoint',
      resourceId: req.params.id as string,
      metadata: data,
    });

    res.json({ message: 'Endpoint updated', id: req.params.id });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /api/webhook-endpoints/:id — Delete endpoint ────

router.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    const existing = await docClient.send(new GetCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      Key: { id: req.params.id },
    }));

    if (!existing.Item || existing.Item.orgId !== orgId) {
      throw new NotFoundError('Webhook endpoint');
    }

    await docClient.send(new DeleteCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      Key: { id: req.params.id },
    }));

    logInfo('Webhook endpoint deleted', { endpointId: req.params.id, orgId });

    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'webhook_endpoint.deleted',
      resourceType: 'webhook_endpoint',
      resourceId: req.params.id as string,
      metadata: { name: existing.Item.name },
    });

    res.json({ message: 'Endpoint deleted', id: req.params.id });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/webhook-endpoints/:id/regenerate-key — Regenerate API key

router.post('/:id/regenerate-key', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    const existing = await docClient.send(new GetCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      Key: { id: req.params.id },
    }));

    if (!existing.Item || existing.Item.orgId !== orgId) {
      throw new NotFoundError('Webhook endpoint');
    }

    const newApiKey = `baton_wh_${crypto.randomBytes(24).toString('hex')}`;

    await docClient.send(new UpdateCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      Key: { id: req.params.id },
      UpdateExpression: 'SET apiKey = :apiKey, updatedAt = :now',
      ExpressionAttributeValues: {
        ':apiKey': newApiKey,
        ':now': new Date().toISOString(),
      },
    }));

    logInfo('Webhook endpoint API key regenerated', { endpointId: req.params.id, orgId });

    res.json({ apiKey: newApiKey });
  } catch (error) {
    next(error);
  }
});

export default router;
