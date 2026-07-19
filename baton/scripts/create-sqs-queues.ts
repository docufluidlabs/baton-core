/**
 * Create SQS Queues — Baton
 * 
 * Usage: npm run sqs:create-queues
 * Creates all SQS queues needed by Baton workers.
 * Safe to run multiple times — skips existing queues.
 */

import { createQueue, QueueNames } from '../src/queue/sqs-client';

const queueConfigs = [
  { name: QueueNames.WEBHOOK_PROCESSING, visibilityTimeout: 60, messageRetentionPeriod: 86400 },
  { name: QueueNames.WORKFLOW_LAUNCHER, visibilityTimeout: 120, messageRetentionPeriod: 86400 },
  { name: QueueNames.TOKEN_REFRESH, visibilityTimeout: 60, messageRetentionPeriod: 3600 },
  { name: QueueNames.NOTIFICATION_SENDER, visibilityTimeout: 30, messageRetentionPeriod: 86400 },
  { name: QueueNames.IDENTITY_SYNC, visibilityTimeout: 120, messageRetentionPeriod: 86400 },
  { name: QueueNames.CLEANUP, visibilityTimeout: 300, messageRetentionPeriod: 86400 },
];

async function createQueues() {
  console.log(`\n📬 Creating ${queueConfigs.length} SQS queues...\n`);

  for (const config of queueConfigs) {
    try {
      const url = await createQueue(config.name, {
        visibilityTimeout: config.visibilityTimeout,
        messageRetentionPeriod: config.messageRetentionPeriod,
      });
      console.log(`  ✅ ${config.name} → ${url}`);
    } catch (error: any) {
      if (error.name === 'QueueNameExists' || error.message?.includes('already exists')) {
        console.log(`  ✅ ${config.name} - already exists`);
      } else {
        console.error(`  ❌ ${config.name} - error: ${error.message}`);
      }
    }
  }

  console.log('\n✨ Done!\n');
}

createQueues().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
