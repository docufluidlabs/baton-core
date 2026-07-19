/**
 * DynamoDB Table Definitions — Baton
 * 
 * Table design follows single-table-per-entity approach for clarity.
 * Each table uses `id` as the partition key (PK).
 * GSIs are added for common query patterns.
 * 
 * Key access patterns:
 * - Organizations: by id, by slug
 * - Users: by id, by orgId, by orgId+email
 * - Connections: by id, by orgId, by orgId+platform
 * - Workflows: by id, by orgId
 * - Instances: by id, by orgId, by workflowId, by status
 * - Rules: by id, by orgId, by orgId+platform+eventType
 * - Pipeline: by id, by orgId (sorted by triggeredAt), by ruleId, by attributedTo
 * - AuditLog: by id, by orgId (sorted by createdAt)
 * - WebhookEvents: by id, by platform (sorted by receivedAt)
 * - Notifications: by id, by recipientId (sorted by createdAt)
 * - OrgApps: by id, by orgId, by webhookKey
 */

import { CreateTableCommandInput } from '@aws-sdk/client-dynamodb';
import { TableNames } from './client';

export const tableDefinitions: CreateTableCommandInput[] = [
  // ─── Organizations ──────────────────────────────────────
  {
    TableName: TableNames.ORGANIZATIONS,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'slug', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'slug-index',
        KeySchema: [{ AttributeName: 'slug', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Users ──────────────────────────────────────────────
  {
    TableName: TableNames.USERS,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'orgId-index',
        KeySchema: [{ AttributeName: 'orgId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
      {
        IndexName: 'orgId-email-index',
        KeySchema: [
          { AttributeName: 'orgId', KeyType: 'HASH' },
          { AttributeName: 'email', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Platform Connections ───────────────────────────────
  {
    TableName: TableNames.PLATFORM_CONNECTIONS,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'platform', AttributeType: 'S' },
      { AttributeName: 'accountId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'orgId-index',
        KeySchema: [{ AttributeName: 'orgId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
      {
        IndexName: 'orgId-platform-index',
        KeySchema: [
          { AttributeName: 'orgId', KeyType: 'HASH' },
          { AttributeName: 'platform', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
      {
        IndexName: 'accountId-index',
        KeySchema: [{ AttributeName: 'accountId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Workflows ──────────────────────────────────────────
  {
    TableName: TableNames.WORKFLOWS,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'orgId-index',
        KeySchema: [{ AttributeName: 'orgId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Workflow Instances ─────────────────────────────────
  {
    TableName: TableNames.WORKFLOW_INSTANCES,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'workflowId', AttributeType: 'S' },
      { AttributeName: 'startedAt', AttributeType: 'S' },
      { AttributeName: 'launchedBy', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'orgId-startedAt-index',
        KeySchema: [
          { AttributeName: 'orgId', KeyType: 'HASH' },
          { AttributeName: 'startedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
      {
        IndexName: 'workflowId-startedAt-index',
        KeySchema: [
          { AttributeName: 'workflowId', KeyType: 'HASH' },
          { AttributeName: 'startedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
      {
        IndexName: 'launchedBy-startedAt-index',
        KeySchema: [
          { AttributeName: 'launchedBy', KeyType: 'HASH' },
          { AttributeName: 'startedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Automation Rules ───────────────────────────────────
  {
    TableName: TableNames.AUTOMATION_RULES,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'webhookKey', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'orgId-index',
        KeySchema: [{ AttributeName: 'orgId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
      {
        IndexName: 'webhookKey-index',
        KeySchema: [{ AttributeName: 'webhookKey', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Trigger Pipeline ──────────────────────────────────
  {
    TableName: TableNames.TRIGGER_PIPELINE,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'triggeredAt', AttributeType: 'S' },
      { AttributeName: 'attributedTo', AttributeType: 'S' },
      { AttributeName: 'ruleId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'orgId-triggeredAt-index',
        KeySchema: [
          { AttributeName: 'orgId', KeyType: 'HASH' },
          { AttributeName: 'triggeredAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 },
      },
      {
        IndexName: 'attributedTo-triggeredAt-index',
        KeySchema: [
          { AttributeName: 'attributedTo', KeyType: 'HASH' },
          { AttributeName: 'triggeredAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
      {
        IndexName: 'ruleId-triggeredAt-index',
        KeySchema: [
          { AttributeName: 'ruleId', KeyType: 'HASH' },
          { AttributeName: 'triggeredAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 },
  },

  // ─── Audit Log ──────────────────────────────────────────
  {
    TableName: TableNames.AUDIT_LOG,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'orgId-createdAt-index',
        KeySchema: [
          { AttributeName: 'orgId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Webhook Events ─────────────────────────────────────
  {
    TableName: TableNames.WEBHOOK_EVENTS,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'platform', AttributeType: 'S' },
      { AttributeName: 'receivedAt', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'platform-receivedAt-index',
        KeySchema: [
          { AttributeName: 'platform', KeyType: 'HASH' },
          { AttributeName: 'receivedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── User Platform Identities ──────────────────────────
  {
    TableName: TableNames.USER_PLATFORM_IDENTITIES,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'orgId_platform_email', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'orgId-platform-email-index',
        KeySchema: [{ AttributeName: 'orgId_platform_email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Notification Preferences ──────────────────────────
  {
    TableName: TableNames.NOTIFICATION_PREFERENCES,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
      {
        IndexName: 'orgId-index',
        KeySchema: [{ AttributeName: 'orgId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Notifications ─────────────────────────────────────
  {
    TableName: TableNames.NOTIFICATIONS,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'recipientId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'recipientId-createdAt-index',
        KeySchema: [
          { AttributeName: 'recipientId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Org Apps ──────────────────────────────────────────
  {
    TableName: TableNames.ORG_APPS,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'webhookKey', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'orgId-index',
        KeySchema: [{ AttributeName: 'orgId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
      {
        IndexName: 'webhookKey-index',
        KeySchema: [{ AttributeName: 'webhookKey', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── OAuth States (TTL-enabled) ────────────────────────
  {
    TableName: TableNames.OAUTH_STATES,
    KeySchema: [
      { AttributeName: 'state', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'state', AttributeType: 'S' },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    // NOTE: Enable TTL on 'ttl' attribute after table creation:
    // aws dynamodb update-time-to-live --table-name baton-oauth-states \
    //   --time-to-live-specification Enabled=true,AttributeName=ttl
  },

  // ─── Bootstrap Tokens (TTL-enabled, one-time-use registration tokens) ─
  // Used by SF managed package v0.3+ bootstrap auth flow:
  //   Baton issues a token when admin creates an automation; SF's first webhook
  //   exchanges it for an HMAC secret via POST /api/salesforce/webhook-registrations.
  {
    TableName: TableNames.BOOTSTRAP_TOKENS,
    KeySchema: [
      { AttributeName: 'tokenId', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'tokenId', AttributeType: 'S' },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    // NOTE: Enable TTL on 'expiresAt' attribute after table creation:
    // aws dynamodb update-time-to-live --table-name baton-bootstrap-tokens \
    //   --time-to-live-specification Enabled=true,AttributeName=expiresAt
  },

  // ─── Slack Configs ─────────────────────────────────────
  // One record per org. PK = orgId (simpler than a separate UUID).
  {
    TableName: TableNames.SLACK_CONFIGS,
    KeySchema: [
      { AttributeName: 'orgId', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'orgId', AttributeType: 'S' },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Queued Webhooks (for paused automations) ─────────────
  {
    TableName: TableNames.QUEUED_WEBHOOKS,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'ruleId', AttributeType: 'S' },
      { AttributeName: 'queuedAt', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'ruleId-queuedAt-index',
        KeySchema: [
          { AttributeName: 'ruleId', KeyType: 'HASH' },
          { AttributeName: 'queuedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Webhook Endpoints ────────────────────────────────
  {
    TableName: TableNames.WEBHOOK_ENDPOINTS,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'orgId-index',
        KeySchema: [{ AttributeName: 'orgId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },
];
