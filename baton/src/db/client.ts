/**
 * DynamoDB Client — Baton
 * Reuses DynamoDB patterns from existing docusignapps monorepo
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import env from '../env';

let client: DynamoDBClient;
let docClient: DynamoDBDocumentClient;

export function getDynamoDBClient(): DynamoDBClient {
  if (!client) {
    const config: any = {
      region: env.DYNAMODB_REGION,
    };

    if (env.DYNAMODB_ENDPOINT) {
      config.endpoint = env.DYNAMODB_ENDPOINT;
    }

    if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      };
    }

    client = new DynamoDBClient(config);
  }
  return client;
}

export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(getDynamoDBClient(), {
      marshallOptions: {
        convertEmptyValues: false,
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
    });
  }
  return docClient;
}

// ─── Table Names ─────────────────────────────────────────────

const prefix = env.DYNAMODB_TABLE_PREFIX;

export const TableNames = {
  ORGANIZATIONS:            `${prefix}organizations`,
  USERS:                    `${prefix}users`,
  PLATFORM_CONNECTIONS:     `${prefix}platform-connections`,
  WORKFLOWS:                `${prefix}workflows`,
  WORKFLOW_INSTANCES:       `${prefix}workflow-instances`,
  AUTOMATION_RULES:         `${prefix}automation-rules`,
  TRIGGER_PIPELINE:         `${prefix}trigger-pipeline`,
  AUDIT_LOG:                `${prefix}audit-log`,
  WEBHOOK_EVENTS:           `${prefix}webhook-events`,
  USER_PLATFORM_IDENTITIES: `${prefix}user-platform-identities`,
  NOTIFICATION_PREFERENCES: `${prefix}notification-preferences`,
  NOTIFICATIONS:            `${prefix}notifications`,
  OAUTH_STATES:             `${prefix}oauth-states`,
  ORG_APPS:                 `${prefix}org-apps`,
  WEBHOOK_ENDPOINTS:        `${prefix}webhook-endpoints`,
  SLACK_CONFIGS:            `${prefix}slack-configs`,
  QUEUED_WEBHOOKS:          `${prefix}queued-webhooks`,
  BOOTSTRAP_TOKENS:         `${prefix}bootstrap-tokens`,
  DOC_OVERRIDES:            `${prefix}doc-overrides`,
} as const;

export type TableName = typeof TableNames[keyof typeof TableNames];
