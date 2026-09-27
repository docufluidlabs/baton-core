/**
 * Webhook event cleanup - Baton
 *
 * Nightly housekeeping for the webhook-events table:
 *
 *  - processed events older than the retention period are deleted;
 *  - idempotency markers (`dedup#...`) of that age are deleted with them;
 *  - credential headers are masked in any stored event that still carries
 *    them (events written before masking on write).
 *
 * The table is walked in pages with no filter: a DynamoDB `Limit` counts the
 * items a scan EXAMINES, not the ones a filter lets through. The walk is
 * bounded per run and resumes where it stopped, so a table larger than one
 * night's budget is still covered end to end.
 */
import { ScanCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { getAppTemplate } from '../lib/app-catalog';
import { redactHeaders } from '../lib/redact';
import { credentialHeadersOf } from '../lib/webhook-auth';
import { logInfo, logWarn } from '../lib/logger';
import { AppSlug } from '../lib/types';

export const EVENT_RETENTION_DAYS = 30;
const PAGE_SIZE = 200;
/** Pages examined per run: bounds the read cost on a large table (20,000 items). */
const MAX_PAGES_PER_RUN = 100;

/** Where the previous run stopped. Lost on restart, which only restarts the walk. */
let cursor: Record<string, unknown> | undefined;

export interface CleanupResult {
  examined: number;
  deleted: number;
  scrubbed: number;
  failed: number;
  /** True when the walk reached the end of the table in this run. */
  completed: boolean;
}

type Outcome = 'deleted' | 'scrubbed' | 'kept';

function credentialHeadersFor(platform: unknown): string[] {
  if (typeof platform !== 'string') return [];
  const template = getAppTemplate(platform as AppSlug);
  return template ? credentialHeadersOf(template.verificationMethod) : [];
}

async function cleanItem(item: Record<string, any>, cutoff: string): Promise<Outcome> {
  const docClient = getDocClient();
  const id = item.id as string;

  const isMarker = typeof id === 'string' && id.startsWith('dedup#');
  const expired = isMarker
    ? typeof item.createdAt === 'string' && item.createdAt <= cutoff
    // Unprocessed events are kept: they are the record of a delivery that
    // never completed.
    : typeof item.receivedAt === 'string' && item.receivedAt <= cutoff && item.processed === true;

  if (expired) {
    await docClient.send(new DeleteCommand({ TableName: TableNames.WEBHOOK_EVENTS, Key: { id } }));
    return 'deleted';
  }

  if (item.headers && typeof item.headers === 'object') {
    const redacted = redactHeaders(item.headers as Record<string, unknown>, credentialHeadersFor(item.platform));
    if (JSON.stringify(redacted) !== JSON.stringify(item.headers)) {
      await docClient.send(new UpdateCommand({
        TableName: TableNames.WEBHOOK_EVENTS,
        Key: { id },
        UpdateExpression: 'SET #headers = :headers',
        // Only an event that still exists: never recreate one deleted meanwhile.
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeNames: { '#headers': 'headers' },
        ExpressionAttributeValues: { ':headers': redacted },
      }));
      return 'scrubbed';
    }
  }
  return 'kept';
}

export async function cleanupWebhookEvents(now: number = Date.now()): Promise<CleanupResult> {
  const docClient = getDocClient();
  const cutoff = new Date(now - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result: CleanupResult = { examined: 0, deleted: 0, scrubbed: 0, failed: 0, completed: false };

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    const scan = await docClient.send(new ScanCommand({
      TableName: TableNames.WEBHOOK_EVENTS,
      // Payloads can be large and are not needed to decide anything here.
      ProjectionExpression: 'id, platform, receivedAt, createdAt, #processed, #headers',
      ExpressionAttributeNames: { '#processed': 'processed', '#headers': 'headers' },
      Limit: PAGE_SIZE,
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }));

    const items = (scan.Items || []) as Record<string, any>[];
    result.examined += items.length;

    const outcomes = await Promise.allSettled(items.map((item) => cleanItem(item, cutoff)));
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') result.failed += 1;
      else if (outcome.value === 'deleted') result.deleted += 1;
      else if (outcome.value === 'scrubbed') result.scrubbed += 1;
    }

    cursor = scan.LastEvaluatedKey;
    if (!cursor) {
      result.completed = true;
      break;
    }
  }

  if (result.failed > 0) {
    logWarn('Webhook event cleanup could not process some events; they are retried on the next run', { ...result });
  } else if (result.deleted > 0 || result.scrubbed > 0) {
    logInfo('Cleaned up webhook events', { ...result });
  }
  return result;
}

/** Test hook: forget where the previous run stopped. */
export function resetCleanupCursor(): void {
  cursor = undefined;
}
