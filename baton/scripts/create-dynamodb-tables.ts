/**
 * Create DynamoDB Tables — Baton
 * 
 * Usage: npm run db:create-tables
 * Reads table definitions and creates all tables.
 * Safe to run multiple times — skips existing tables.
 */

import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { getDynamoDBClient } from '../src/db/client';
import { tableDefinitions } from '../src/db/table-definitions';

async function createTables() {
  const client = getDynamoDBClient();

  console.log(`\n🗄️  Creating ${tableDefinitions.length} DynamoDB tables...\n`);

  for (const tableDef of tableDefinitions) {
    const tableName = tableDef.TableName!;

    try {
      // Check if table exists
      await client.send(new DescribeTableCommand({ TableName: tableName }));
      console.log(`  ✅ ${tableName} — already exists`);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        // Create table
        await client.send(new CreateTableCommand(tableDef));
        console.log(`  🆕 ${tableName} — created`);
      } else {
        console.error(`  ❌ ${tableName} — error: ${error.message}`);
      }
    }
  }

  console.log('\n✨ Done!\n');
}

createTables().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
