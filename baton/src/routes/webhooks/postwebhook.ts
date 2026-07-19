/**
 * Postwebhook Receiver — Baton
 *
 * Public endpoint for receiving webhook POST requests on custom endpoints.
 * Route: POST /api/postwebhook/:orgId/:endpointId
 *
 * Flow:
 * 1. Lookup endpoint by ID, verify orgId matches
 * 2. Validate API key (if configured)
 * 3. Per-endpoint rate limiting
 * 4. Parse payload, extract record ID using configured payloadFieldPath
 * 5. Store webhook event
 * 6. Queue workflow launch via SQS
 * 7. Return 200 immediately
 */
import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../../db/client';
import { WebhookEndpoint, WebhookProcessingJob, TriggerPipelineEntry, WorkflowLaunchJob } from '../../lib/types';
import * as webhookEventService from '../../services/webhook-event.service';
import { sendMessage, QueueNames } from '../../queue/sqs-client';
import { logInfo, logWarn, logError } from '../../lib/logger';

const router = Router();

// ─── In-memory rate limiter per endpoint ─────────────────────

const endpointRequestCounts = new Map<string, { count: number; resetAt: number }>();

function checkEndpointRateLimit(endpointId: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const entry = endpointRequestCounts.get(endpointId);

  if (!entry || now >= entry.resetAt) {
    endpointRequestCounts.set(endpointId, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= limitPerMinute) {
    return false;
  }

  entry.count++;
  return true;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of endpointRequestCounts.entries()) {
    if (now >= entry.resetAt) {
      endpointRequestCounts.delete(key);
    }
  }
}, 5 * 60_000);

// ─── Helper: extract value by dot-notation path ─────────────

function extractFieldValue(payload: Record<string, any>, fieldPath: string): any {
  const parts = fieldPath.replace(/^\$\./, '').split('.');
  let current: any = payload;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    // Support array index notation: items[0]
    const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]];
      if (Array.isArray(current)) {
        current = current[parseInt(arrayMatch[2], 10)];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }
  return current;
}

// ─── POST /:orgId/:endpointId ────────────────────────────────

router.post('/:orgId/:endpointId', async (req: Request, res: Response, _next: NextFunction) => {
  const orgId = req.params.orgId as string;
  const endpointId = req.params.endpointId as string;

  try {
    const docClient = getDocClient();

    // 1. Lookup endpoint
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      Key: { id: endpointId },
    }));

    const endpoint = result.Item as WebhookEndpoint | undefined;

    if (!endpoint || endpoint.orgId !== orgId) {
      logWarn('Postwebhook received for unknown endpoint', { orgId, endpointId });
      res.status(404).json({ error: 'Endpoint not found' });
      return;
    }

    if (!endpoint.enabled) {
      res.status(403).json({ error: 'Endpoint is disabled' });
      return;
    }

    // 2. Validate API key (if configured)
    if (endpoint.apiKey) {
      const providedKey = req.headers['x-api-key'] as string;
      if (!providedKey || providedKey !== endpoint.apiKey) {
        logWarn('Postwebhook invalid API key', { orgId, endpointId });
        res.status(401).json({ error: 'Invalid or missing API key' });
        return;
      }
    }

    // 3. Rate limiting
    if (!checkEndpointRateLimit(endpointId, endpoint.rateLimitPerMinute)) {
      logWarn('Postwebhook rate limit exceeded', { orgId, endpointId });
      res.status(429).json({ error: 'Rate limit exceeded', retryAfterSeconds: 60 });
      return;
    }

    // 4. Parse payload
    const rawBody = req.body as Buffer;
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      logWarn('Invalid JSON in postwebhook body', { orgId, endpointId });
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    // 5. Extract record ID from payload
    const recordId = extractFieldValue(payload, endpoint.payloadFieldPath);
    const recordIdStr = recordId != null ? String(recordId) : undefined;

    logInfo('Postwebhook received', {
      orgId,
      endpointId,
      platform: endpoint.platform,
      recordId: recordIdStr,
    });

    // 6. Store webhook event
    const event = await webhookEventService.storeWebhookEvent({
      platform: endpoint.platform as any,
      connectionId: undefined,
      payload,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
      ),
      signatureValid: true,
    });

    // 7. Return 200 immediately
    res.status(200).json({ received: true, eventId: event.id });

    // Skip post-processing on duplicate delivery (#12)
    if (event.id === 'duplicate') {
      return;
    }

    // 8. Create pipeline entry
    const now = new Date().toISOString();
    const pipelineEntryId = uuidv4();
    // Truncate rawPayload if it would exceed DynamoDB's 400 KB item limit (#19)
    const rawPayloadJson = JSON.stringify(payload);
    const safeRawPayload = rawPayloadJson.length > 50_000
      ? { _truncated: true, size: rawPayloadJson.length, preview: rawPayloadJson.slice(0, 500) }
      : payload;

    const pipelineEntry: TriggerPipelineEntry = {
      id: pipelineEntryId,
      orgId,
      sourcePlatform: endpoint.platform as any,
      eventType: 'inbound',
      eventSummary: `Webhook received on "${endpoint.name}"${recordIdStr ? ` (ID: ${recordIdStr})` : ''}`,
      rawPayload: safeRawPayload,
      actionDescription: `Launching workflow for endpoint "${endpoint.name}"`,
      status: 'running',
      attributedTo: undefined,
      triggeredAt: now,
      durationMs: 0,
      attemptNumber: 1,
      userActionable: false,
    };

    await docClient.send(new PutCommand({
      TableName: TableNames.TRIGGER_PIPELINE,
      Item: pipelineEntry,
    }));

    // 9. Build trigger inputs from payload
    // Always include the full payload + extracted record ID
    const triggerInputs: Record<string, any> = {
      ...payload,
    };
    if (recordIdStr) {
      triggerInputs._recordId = recordIdStr;
    }

    // 10. Queue workflow launch
    const instanceName = `${endpoint.name} - ${recordIdStr || 'webhook'} - ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`;

    await sendMessage<WorkflowLaunchJob>(QueueNames.WORKFLOW_LAUNCHER, {
      ruleId: `endpoint:${endpointId}`,
      pipelineEntryId,
      workflowId: endpoint.workflowId,
      orgId,
      inputData: triggerInputs,
      instanceName,
    });

    // 11. Update endpoint stats
    await docClient.send(new UpdateCommand({
      TableName: TableNames.WEBHOOK_ENDPOINTS,
      Key: { id: endpointId },
      UpdateExpression: 'SET requestCount = requestCount + :inc, lastRequestAt = :now',
      ExpressionAttributeValues: { ':inc': 1, ':now': now },
    }));

    logInfo('Postwebhook queued for workflow launch', {
      eventId: event.id,
      endpointId,
      workflowId: endpoint.workflowId,
    });
  } catch (error: any) {
    logError('Postwebhook handler error', error, { orgId, endpointId });
    // Return 200 to prevent retries
    res.status(200).json({ received: true, error: 'Processing error' });
  }
});

export default router;
