/**
 * Delete DynamoDB Tables — Baton
 * 
 * Usage: npm run db:delete-tables
 * ⚠️  DESTRUCTIVE — deletes all Baton tables.
 */

import { DeleteTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { getDynamoDBClient, TableNames } from '../src/db/client';

async function deleteTables() {
  const client = getDynamoDBClient();
  const tableNames = Object.values(TableNames);

  console.log(`\n🗑️  Deleting ${tableNames.length} DynamoDB tables...\n`);

  for (const tableName of tableNames) {
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
      await client.send(new DeleteTableCommand({ TableName: tableName }));
      console.log(`  🗑️  ${tableName} — deleted`);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`  ⏭️  ${tableName} — not found, skipping`);
      } else {
        console.error(`  ❌ ${tableName} — error: ${error.message}`);
      }
    }
  }

  console.log('\n✨ Done!\n');
}

deleteTables().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
