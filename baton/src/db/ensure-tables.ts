/**
 * Boot-time DynamoDB table setup — mirrors ensureAllQueuesExist() in queue/sqs-client.ts.
 *
 * Local dev (DYNAMODB_ENDPOINT set → LocalStack): missing tables are created and TTL is
 * enabled, so `docker compose up` works with no host-side tooling.
 * Real AWS (no endpoint): tables are pre-created by CloudFormation (baton/infrastructure/)
 * and a missing table is a fatal misconfiguration — the app role does not need CreateTable.
 *
 * The `npm run db:create-tables` script reuses this with `createMissing: true` so it can
 * also create tables on real AWS when invoked explicitly with sufficient credentials.
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { getDynamoDBClient, TableNames } from './client';
import { tableDefinitions } from './table-definitions';
import env from '../env';
import { logger } from '../lib/logger';

// TTL-based tables (see docs/SETUP.md) — enabled right after creation.
const TTL_SPECS: Array<{ table: string; attribute: string }> = [
  { table: TableNames.OAUTH_STATES, attribute: 'ttl' },
  { table: TableNames.BOOTSTRAP_TOKENS, attribute: 'expiresAt' },
];

export interface EnsureTablesResult {
  created: string[];
  existing: string[];
}

export async function ensureAllTablesExist(opts?: {
  createMissing?: boolean;
}): Promise<EnsureTablesResult> {
  const client = getDynamoDBClient();
  // Same convention as ensureAllQueuesExist: an explicit endpoint means LocalStack.
  const createMissing = opts?.createMissing ?? Boolean(env.DYNAMODB_ENDPOINT);

  const created: string[] = [];
  const existing: string[] = [];

  for (const tableDef of tableDefinitions) {
    const tableName = tableDef.TableName!;
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
      existing.push(tableName);
    } catch (err: any) {
      if (err.name !== 'ResourceNotFoundException') {
        throw err;
      }
      if (!createMissing) {
        throw new Error(
          `DynamoDB table "${tableName}" does not exist. Create it via CloudFormation (baton/infrastructure/) before starting the server.`,
        );
      }
      await client.send(new CreateTableCommand(tableDef));
      await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: tableName });
      logger.info({ tableName }, 'DynamoDB table created');
      created.push(tableName);
    }
  }

  // Enable TTL on freshly created TTL-based tables. Non-fatal: a re-run against a
  // table that already has TTL enabled (or a backend without TTL support) just warns.
  for (const spec of TTL_SPECS) {
    if (!created.includes(spec.table)) continue;
    try {
      await client.send(
        new UpdateTimeToLiveCommand({
          TableName: spec.table,
          TimeToLiveSpecification: { Enabled: true, AttributeName: spec.attribute },
        }),
      );
      logger.info({ tableName: spec.table, attribute: spec.attribute }, 'TTL enabled');
    } catch (err) {
      logger.warn({ err, tableName: spec.table }, 'Could not enable TTL');
    }
  }

  return { created, existing };
}
