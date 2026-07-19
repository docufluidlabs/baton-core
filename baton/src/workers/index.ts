/**
 * SQS Workers — Baton
 * 
 * Long-polling SQS consumers for async job processing.
 * Each worker polls a specific queue and processes messages.
 */

import { receiveMessages, deleteMessage, QueueNames, SQSMessage } from '../queue/sqs-client';
import { logger, createLogger } from '../lib/logger';
import { WebhookProcessingJob, WorkflowLaunchJob, TokenRefreshJob, NotificationJob } from '../lib/types';

// Import processors
import { processWebhookJob } from './webhook.worker';
import { processWorkflowLaunchJob } from './workflow-launcher.worker';
import { processTokenRefreshJob } from './token-refresh.worker';
import { processNotificationJob, NotificationJob as NotificationJobType } from './notification-sender.worker';

// ─── Graceful Shutdown ───────────────────────────────────────

let shuttingDown = false;
const abortController = new AbortController();

export function stopAllWorkers(): void {
  shuttingDown = true;
  abortController.abort();
  logger.info('Stopping all SQS workers...');
}

// ─── Worker Loop ─────────────────────────────────────────────

interface WorkerConfig<T> {
  queueName: string;
  processor: (job: T) => Promise<void>;
  concurrency: number;
  pollIntervalMs?: number;
  visibilityTimeoutSeconds?: number;
}

async function startWorker<T>(config: WorkerConfig<T>): Promise<void> {
  const { queueName, processor, concurrency, pollIntervalMs = 1000, visibilityTimeoutSeconds } = config;
  const log = createLogger({ worker: 'sqs-poller', queueName });

  log.info({ concurrency }, 'Starting SQS worker');

  while (!shuttingDown) {
    try {
      // Use 20s long-poll (#31) and per-queue VisibilityTimeout (#05)
      const messages = await receiveMessages<T>(
        queueName, concurrency, 20, abortController.signal, visibilityTimeoutSeconds,
      );

      if (shuttingDown) break;
      if (messages.length === 0) continue;

      log.debug({ count: messages.length }, 'Received messages');

      // Process in parallel (up to concurrency)
      await Promise.allSettled(
        messages.map(async (msg: SQSMessage<T>) => {
          try {
            await processor(msg.body);
            await deleteMessage(queueName, msg.receiptHandle);
            log.debug({ messageId: msg.messageId }, 'Message processed and deleted');
          } catch (error: any) {
            log.error({ err: error, messageId: msg.messageId }, 'Message processing failed');
            // Don't delete — SQS will re-deliver after visibility timeout
          }
        })
      );
    } catch (error: any) {
      if (shuttingDown || error.name === 'AbortError') break;
      log.error({ err: error }, 'Worker poll error');
      // Back off on errors
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  log.info('SQS worker stopped');
}

// ─── Start All Workers ───────────────────────────────────────

export async function startAllWorkers(): Promise<void> {
  logger.info('Starting all SQS workers...');

  // Start workers in parallel (they each run infinite loops)
  // Using setImmediate to not block the event loop
  setImmediate(() => {
    startWorker<WebhookProcessingJob>({
      queueName: QueueNames.WEBHOOK_PROCESSING,
      processor: processWebhookJob,
      concurrency: 10,
      visibilityTimeoutSeconds: 90, // #05
    }).catch((err) => logger.error({ err, queueName: QueueNames.WEBHOOK_PROCESSING }, 'Worker crashed'));
  });

  setImmediate(() => {
    startWorker<WorkflowLaunchJob>({
      queueName: QueueNames.WORKFLOW_LAUNCHER,
      processor: processWorkflowLaunchJob,
      concurrency: 5,
      visibilityTimeoutSeconds: 180, // #05: Maestro calls can take up to 2-3 min
    }).catch((err) => logger.error({ err, queueName: QueueNames.WORKFLOW_LAUNCHER }, 'Worker crashed'));
  });

  setImmediate(() => {
    startWorker<TokenRefreshJob>({
      queueName: QueueNames.TOKEN_REFRESH,
      processor: processTokenRefreshJob,
      concurrency: 1,
      visibilityTimeoutSeconds: 60, // #05
    }).catch((err) => logger.error({ err, queueName: QueueNames.TOKEN_REFRESH }, 'Worker crashed'));
  });

  setImmediate(() => {
    startWorker<NotificationJobType>({
      queueName: QueueNames.NOTIFICATION_SENDER,
      processor: processNotificationJob,
      concurrency: 5,
      visibilityTimeoutSeconds: 45, // #05
    }).catch((err) => logger.error({ err, queueName: QueueNames.NOTIFICATION_SENDER }, 'Worker crashed'));
  });

  logger.info('All SQS workers started');
}
