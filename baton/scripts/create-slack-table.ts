/**
 * Create slack-configs DynamoDB table.
 * Run: npx tsx scripts/create-slack-table.ts
 *
 * Or re-run all tables:
 *   npm run db:create-tables
 */
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { getDynamoDBClient } from '../src/db/client';
import { TableNames } from '../src/db/client';

async function main() {
  const client = getDynamoDBClient();
  const tableName = TableNames.SLACK_CONFIGS;

  // Check if already exists
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`✓ Table "${tableName}" already exists`);
    return;
  } catch (err: any) {
    if (err.name !== 'ResourceNotFoundException') throw err;
  }

  await client.send(new CreateTableCommand({
    TableName: tableName,
    KeySchema: [{ AttributeName: 'orgId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'orgId', AttributeType: 'S' }],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  }));

  console.log(`✅ Created table "${tableName}"`);
}

main().catch(console.error);
