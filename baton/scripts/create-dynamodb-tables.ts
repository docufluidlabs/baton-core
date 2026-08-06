/**
 * Create DynamoDB Tables — Baton
 *
 * Usage: npm run db:create-tables
 * Reads table definitions and creates all tables (TTL included).
 * Safe to run multiple times — skips existing tables.
 *
 * The server also runs the same ensure step on boot (see src/db/ensure-tables.ts):
 * against LocalStack it creates missing tables automatically; on real AWS this
 * script (or CloudFormation) is the explicit way to create them.
 */

import { ensureAllTablesExist } from '../src/db/ensure-tables';
import { tableDefinitions } from '../src/db/table-definitions';

async function createTables() {
  console.log(`\n🗄️  Creating ${tableDefinitions.length} DynamoDB tables...\n`);

  const { created, existing } = await ensureAllTablesExist({ createMissing: true });

  for (const tableDef of tableDefinitions) {
    const tableName = tableDef.TableName!;
    if (created.includes(tableName)) {
      console.log(`  🆕 ${tableName} - created`);
    } else if (existing.includes(tableName)) {
      console.log(`  ✅ ${tableName} - already exists`);
    }
  }

  console.log('\n✨ Done!\n');
}

createTables().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
