/**
 * Webhook Processing Worker — Baton
 *
 * Processes webhook events from the SQS queue:
 * 1. Load raw event from DynamoDB
 * 2. Extract event info via connector
 * 3. Pass to Rule Engine for matching + workflow launching
 * 4. Mark event as processed
 */

import { WebhookProcessingJob } from '../lib/types';
import { createLogger } from '../lib/logger';
import { getConnector, hasConnector } from '../services/connectors';
import { ExtractedEventInfo } from '../services/connectors';
import * as webhookEventService from '../services/webhook-event.service';
import * as ruleEngine from '../services/rule-engine.service';

export async function processWebhookJob(job: WebhookProcessingJob): Promise<void> {
  const { eventId, platform, orgId, connectionId, requestId, ruleId, sfDispatchId } = job;
  const log = createLogger({ worker: 'webhook', eventId, platform, orgId, requestId, sfDispatchId });

  log.info('Processing webhook event');

  try {
    // 1. Load raw event
    const event = await webhookEventService.getWebhookEvent(eventId);
    if (!event) {
      log.warn('Webhook event not found, skipping');
      return;
    }

    // Idempotency guard: SQS delivers at-least-once, so the same message may
    // arrive multiple times. Skip if already processed successfully.
    if (event.processed && !event.error) {
      log.warn('Webhook event already processed, skipping duplicate delivery');
      return;
    }

    // 2. Extract event info via connector (or build generic info for apps)
    let eventInfo: ExtractedEventInfo;

    if (hasConnector(platform)) {
      const connector = getConnector(platform);
      eventInfo = connector.extractEventInfo(event.payload);
    } else {
      // Generic extraction for catalog apps (no connector)
      eventInfo = {
        eventType: event.payload.event_type || event.payload.eventType || event.payload.type || 'webhook',
        eventLabel: event.payload.event_type || event.payload.eventType || event.payload.type || 'Webhook Event',
        summary: event.payload.summary || event.payload.description || `${platform} webhook received`,
        actingUserEmail: event.payload.user_email || event.payload.email,
        recordId: event.payload.record_id || event.payload.id,
        metadata: event.payload,
      };
    }

    log.info({
      eventType: eventInfo.eventType,
      summary: eventInfo.summary,
      actingUser: eventInfo.actingUserEmail,
    }, 'Event extracted');

    // 3. Pass to Rule Engine — find matching rules and queue workflow launches
    const result = await ruleEngine.processEvent({
      orgId,
      connectionId,
      platform,
      eventInfo,
      rawPayload: event.payload,
      webhookEventId: eventId,
      requestId,
      ruleId,
      sfDispatchId,
    });

    // 4. Mark as processed
    await webhookEventService.markProcessed(eventId);

    log.info({
      eventType: result.eventType,
      matchedRules: result.matchedRules,
      launchedWorkflows: result.launchedWorkflows,
    }, 'Webhook event fully processed');
  } catch (error: any) {
    log.error({ err: error }, 'Webhook processing failed');
    // Do NOT mark as processed — let SQS retry the message with its backoff policy.
    // Marking processed AND throwing was wrong: the event would be retried but then
    // skipped by the idempotency guard above (processed=true, no error yet stored).
    throw error;
  }
}
