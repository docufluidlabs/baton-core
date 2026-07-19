/**
 * SQS Client — Baton
 * Replaces BullMQ + Redis with AWS SQS for job processing
 */
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  CreateQueueCommand,
} from '@aws-sdk/client-sqs';
import env from '../env';
import { logger } from '../lib/logger';

let sqsClient: SQSClient;

export function getSQSClient(): SQSClient {
  if (!sqsClient) {
    const config: any = {
      region: env.SQS_REGION,
    };

    if (env.SQS_ENDPOINT) {
      config.endpoint = env.SQS_ENDPOINT;
    }

    if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      };
    }

    sqsClient = new SQSClient(config);
  }
  return sqsClient;
}

// ─── Queue Names ─────────────────────────────────────────────

const prefix = env.SQS_QUEUE_PREFIX;

export const QueueNames = {
  WEBHOOK_PROCESSING: `${prefix}webhook-processing`,
  WORKFLOW_LAUNCHER:   `${prefix}workflow-launcher`,
  TOKEN_REFRESH:       `${prefix}token-refresh`,
  NOTIFICATION_SENDER: `${prefix}notification-sender`,
  IDENTITY_SYNC:       `${prefix}identity-sync`,
  CLEANUP:             `${prefix}cleanup`,
} as const;

export type QueueName = typeof QueueNames[keyof typeof QueueNames];

// ─── Queue URL Cache ─────────────────────────────────────────

const queueUrlCache: Map<string, string> = new Map();

export async function getQueueUrl(queueName: string): Promise<string> {
  if (queueUrlCache.has(queueName)) {
    return queueUrlCache.get(queueName)!;
  }

  const client = getSQSClient();
  const result = await client.send(new GetQueueUrlCommand({ QueueName: queueName }));
  const url = result.QueueUrl!;
  queueUrlCache.set(queueName, url);
  return url;
}

// ─── Producer ────────────────────────────────────────────────

export async function sendMessage<T>(queueName: string, body: T, options?: {
  delaySeconds?: number;
  messageGroupId?: string;
  deduplicationId?: string;
}): Promise<string> {
  const client = getSQSClient();
  const queueUrl = await getQueueUrl(queueName);

  const result = await client.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(body),
    DelaySeconds: options?.delaySeconds,
    MessageGroupId: options?.messageGroupId,
    MessageDeduplicationId: options?.deduplicationId,
  }));

  logger.debug({ queueName, messageId: result.MessageId }, 'SQS message sent');
  return result.MessageId!;
}

// ─── Consumer ────────────────────────────────────────────────

export interface SQSMessage<T> {
  body: T;
  receiptHandle: string;
  messageId: string;
}

export async function receiveMessages<T>(
  queueName: string,
  maxMessages: number = 10,
  waitTimeSeconds: number = 20,
  abortSignal?: AbortSignal,
  // visibilityTimeoutSeconds: per-queue override so long-running jobs (#05)
  // don't re-appear while still being processed.
  // workflow-launcher: 180s, webhook-processing: 90s, notification-sender: 45s
  visibilityTimeoutSeconds?: number,
): Promise<SQSMessage<T>[]> {
  const client = getSQSClient();
  const queueUrl = await getQueueUrl(queueName);

  const result = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: waitTimeSeconds,
      // Per-queue VisibilityTimeout (#05): caller passes the right value so that
      // long-running jobs don't re-appear and cause duplicate launches.
      ...(visibilityTimeoutSeconds !== undefined && { VisibilityTimeout: visibilityTimeoutSeconds }),
    }),
    { abortSignal },
  );

  if (!result.Messages) return [];

  const parsed: SQSMessage<T>[] = [];
  for (const msg of result.Messages) {
    try {
      parsed.push({
        body: JSON.parse(msg.Body!) as T,
        receiptHandle: msg.ReceiptHandle!,
        messageId: msg.MessageId!,
      });
    } catch {
      logger.warn(
        { messageId: msg.MessageId, queueName },
        'Skipping unparseable SQS message — deleting from queue',
      );
      // Delete the poison message so it doesn't block the queue
      try {
        await deleteMessage(queueName, msg.ReceiptHandle!);
      } catch (delErr) {
        logger.error({ messageId: msg.MessageId, err: delErr }, 'Failed to delete poison message');
      }
    }
  }
  return parsed;
}

export async function deleteMessage(queueName: string, receiptHandle: string): Promise<void> {
  const client = getSQSClient();
  const queueUrl = await getQueueUrl(queueName);

  await client.send(new DeleteMessageCommand({
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  }));
}

// ─── Queue Setup ─────────────────────────────────────────────

export async function createQueue(queueName: string, options?: {
  fifo?: boolean;
  visibilityTimeout?: number;
  messageRetentionPeriod?: number;
}): Promise<string> {
  const client = getSQSClient();

  const attributes: Record<string, string> = {
    VisibilityTimeout: String(options?.visibilityTimeout ?? 60),
    MessageRetentionPeriod: String(options?.messageRetentionPeriod ?? 86400), // 24h default
  };

  if (options?.fifo) {
    attributes['FifoQueue'] = 'true';
    attributes['ContentBasedDeduplication'] = 'true';
  }

  const result = await client.send(new CreateQueueCommand({
    QueueName: options?.fifo ? `${queueName}.fifo` : queueName,
    Attributes: attributes,
  }));

  logger.info({ queueName, queueUrl: result.QueueUrl }, 'SQS queue created');
  return result.QueueUrl!;
}

export async function ensureAllQueuesExist(): Promise<void> {
  const queues = [
    { name: QueueNames.WEBHOOK_PROCESSING, visibilityTimeout: 60,  messageRetentionPeriod: 86400 },
    { name: QueueNames.WORKFLOW_LAUNCHER,  visibilityTimeout: 120, messageRetentionPeriod: 86400 },
    { name: QueueNames.TOKEN_REFRESH,      visibilityTimeout: 60,  messageRetentionPeriod: 3600  },
    { name: QueueNames.NOTIFICATION_SENDER,visibilityTimeout: 30,  messageRetentionPeriod: 86400 },
    { name: QueueNames.IDENTITY_SYNC,      visibilityTimeout: 120, messageRetentionPeriod: 86400 },
    { name: QueueNames.CLEANUP,            visibilityTimeout: 300, messageRetentionPeriod: 86400 },
  ];

  // In production queues are pre-created by CloudFormation — only attempt CreateQueue
  // in local dev (SQS_ENDPOINT indicates LocalStack or similar).
  const isLocalDev = Boolean(env.SQS_ENDPOINT);

  for (const q of queues) {
    try {
      await getQueueUrl(q.name);
      logger.debug({ queueName: q.name }, 'SQS queue exists');
    } catch (err: any) {
      const notFound = err.name === 'QueueDoesNotExist' || err.name === 'AWS.SimpleQueueService.NonExistentQueue';
      if (notFound && isLocalDev) {
        await createQueue(q.name, { visibilityTimeout: q.visibilityTimeout, messageRetentionPeriod: q.messageRetentionPeriod });
      } else if (notFound) {
        throw new Error(`SQS queue "${q.name}" does not exist. Create it via CloudFormation before starting the server.`);
      } else {
        throw err;
      }
    }
  }
}
