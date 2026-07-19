/**
 * Notification Sender Worker — Baton
 *
 * Processes NotificationJob from SQS:
 *   - Reads job payload
 *   - Calls notification.service.sendNotification()
 *   - Handles delivery errors gracefully (don't re-queue on send failures)
 */

import { sendNotification, NotificationPayload } from '../services/notification.service';
import { createLogger } from '../lib/logger';

export interface NotificationJob {
  type: 'notification';
  payload: NotificationPayload;
}

export async function processNotificationJob(job: NotificationJob): Promise<void> {
  const { payload } = job;
  const log = createLogger({
    worker: 'notification-sender',
    recipientId: payload.recipientId,
    category: payload.category,
  });

  log.info({ severity: payload.severity, title: payload.title }, 'Processing notification job');

  try {
    await sendNotification(payload);

    log.info('Notification delivered');
  } catch (error: any) {
    // Log but don't re-throw — notification delivery failures
    // should not cause SQS retries (could spam the user)
    log.error({ err: error }, 'Notification delivery failed (will not retry)');
  }
}
