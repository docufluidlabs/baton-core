/**
 * Webhook Event Service — Baton
 *
 * Stores raw webhook events in DynamoDB for deduplication and audit.
 *
 * #12 — Idempotency: platforms frequently retry webhook delivery.
 * Each call to storeWebhookEvent extracts a platform-native event ID
 * (e.g. DocuSign envelopeId, HubSpot eventId) and
 * uses a ConditionExpression to ensure only one record per platform event.
 * On a duplicate, the function returns the existing event without re-queuing.
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logInfo, logDebug, logWarn } from '../lib/logger';
import { Platform, WebhookEvent } from '../lib/types';

// ─── Platform event ID extraction ────────────────────────────

/**
 * Extract the platform-native event ID from a webhook payload.
 * This is used as an idempotency key to prevent duplicate processing
 * when platforms retry delivery.
 */
function extractPlatformEventId(platform: Platform, payload: Record<string, any>): string | undefined {
  switch (platform) {
    case 'docusign': {
      // DocuSign Connect: envelopeId is stable across retries
      return payload.envelopeId || payload.data?.envelopeId || payload.EnvelopeID;
    }
    case 'hubspot': {
      const events = Array.isArray(payload) ? payload : [payload];
      // Use the first eventId as the key; batch retries share the same event IDs
      return events.map((e: any) => e.eventId).filter(Boolean).sort().join(',');
    }
    case 'bamboohr': {
      return payload.id?.toString() || payload.eventId?.toString();
    }
    case 'zohocrm': {
      // Zoho doesn't provide a stable event ID — use a hash of org_id + ids
      const orgId = payload.org_id?.toString() || '';
      const ids = (payload.ids || []).sort().join(',');
      const module = payload.module || '';
      const operation = payload.operation || '';
      if (orgId && ids) return `${orgId}:${module}:${operation}:${ids}`;
      return undefined;
    }
    default:
      return undefined;
  }
}

// ─── Store webhook event (idempotent) ────────────────────────

export interface StoreWebhookEventResult {
  event: WebhookEvent;
  isDuplicate: boolean;
}

/**
 * Store a raw webhook event idempotently.
 * Returns { event, isDuplicate } so callers can skip re-queuing on duplicates.
 */
export async function storeWebhookEvent(params: {
  platform: Platform;
  connectionId?: string;
  payload: Record<string, any>;
  headers?: Record<string, any>;
  signatureValid?: boolean;
}): Promise<WebhookEvent> {
  const docClient = getDocClient();
  const now = new Date().toISOString();
  const id = uuidv4();

  const platformEventId = extractPlatformEventId(params.platform, params.payload);

  const event: WebhookEvent & { platformEventId?: string } = {
    id,
    platform: params.platform,
    connectionId: params.connectionId,
    payload: params.payload,
    headers: params.headers,
    signatureValid: params.signatureValid,
    processed: false,
    receivedAt: now,
    ...(platformEventId ? { platformEventId } : {}),
  };

  // If we have a platform-native event ID, use an atomic dedup marker to prevent
  // duplicate storage when platforms retry delivery.
  //
  // Strategy: write a lightweight sentinel record with id = "dedup#<platformEventId>"
  // using ConditionExpression: attribute_not_exists(id). Because DynamoDB enforces
  // uniqueness on the primary key, this is a true atomic guard — the second concurrent
  // delivery will get ConditionalCheckFailedException and be dropped immediately.
  // (The previous approach checked attribute_not_exists on a fresh UUID, which was
  // always true and provided no dedup protection at all.)
  if (platformEventId) {
    const dedupKey = `dedup#${platformEventId}`;
    try {
      await docClient.send(new PutCommand({
        TableName: TableNames.WEBHOOK_EVENTS,
        Item: { id: dedupKey, platform: params.platform, platformEventId, createdAt: event.receivedAt },
        ConditionExpression: 'attribute_not_exists(id)',
      }));
    } catch (err: any) {
      if (err instanceof ConditionalCheckFailedException || err.name === 'ConditionalCheckFailedException') {
        logWarn('Duplicate webhook event detected (idempotency guard)', {
          platform: params.platform,
          platformEventId,
        });
        // Return a stub — caller should skip re-queuing
        return { ...event, id: 'duplicate' };
      }
      throw err;
    }

    // Dedup marker written — now store the actual event (no condition needed,
    // the marker above is the atomic lock)
    await docClient.send(new PutCommand({
      TableName: TableNames.WEBHOOK_EVENTS,
      Item: event,
    }));
  } else {
    // No platform event ID available — store without idempotency guard
    await docClient.send(new PutCommand({
      TableName: TableNames.WEBHOOK_EVENTS,
      Item: event,
    }));
  }

  logDebug('Webhook event stored', { id, platform: params.platform, platformEventId });
  return event;
}

/**
 * Mark webhook event as processed
 */
export async function markProcessed(eventId: string, error?: string): Promise<void> {
  if (eventId === 'duplicate') return; // guard for idempotency stub

  const docClient = getDocClient();

  await docClient.send(new UpdateCommand({
    TableName: TableNames.WEBHOOK_EVENTS,
    Key: { id: eventId },
    UpdateExpression: error
      ? 'SET #proc = :processed, processedAt = :processedAt, #err = :error'
      : 'SET #proc = :processed, processedAt = :processedAt',
    ExpressionAttributeValues: {
      ':processed': true,
      ':processedAt': new Date().toISOString(),
      ...(error ? { ':error': error } : {}),
    },
    ExpressionAttributeNames: {
      '#proc': 'processed',
      ...(error ? { '#err': 'error' } : {}),
    },
  }));
}

/**
 * Get webhook event by ID
 */
export async function getWebhookEvent(id: string): Promise<WebhookEvent | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.WEBHOOK_EVENTS,
    Key: { id },
  }));
  return (result.Item as WebhookEvent) || null;
}

/**
 * Get recent webhook events by platform
 */
export async function getRecentByPlatform(platform: Platform, limit: number = 20): Promise<WebhookEvent[]> {
  const docClient = getDocClient();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.WEBHOOK_EVENTS,
    IndexName: 'platform-receivedAt-index',
    KeyConditionExpression: 'platform = :platform',
    ExpressionAttributeValues: { ':platform': platform },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (result.Items as WebhookEvent[]) || [];
}
