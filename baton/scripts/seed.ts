/**
 * Seed — Baton
 *
 * Headless first-run setup: creates the organization + owner user from env
 * vars, using the exact same code path as POST /api/auth/setup.
 *
 * Usage: npm run seed
 *
 * Required env:
 *   BATON_OWNER_EMAIL     owner login email
 *   BATON_OWNER_PASSWORD  owner password (min 8 chars)
 * Optional env:
 *   BATON_ORG_NAME        organization name (default: "Baton")
 *   BATON_OWNER_NAME      owner display name (default: "Owner")
 *
 * Idempotent: exits 0 without writing anything when any user already exists.
 */
import { needsSetup, performSetup } from '../src/services/local-auth.service';

async function seed() {
  const email = process.env.BATON_OWNER_EMAIL || '';
  const password = process.env.BATON_OWNER_PASSWORD || '';
  const orgName = process.env.BATON_ORG_NAME || 'Baton';
  const name = process.env.BATON_OWNER_NAME || 'Owner';

  if (!email || !password) {
    console.error('❌ BATON_OWNER_EMAIL and BATON_OWNER_PASSWORD must be set to seed.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('❌ BATON_OWNER_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  if (!(await needsSetup())) {
    console.log('✅ Users already exist — nothing to seed.');
    return;
  }

  const { user, org } = await performSetup({ orgName, name, email, password });
  console.log(`✨ Seeded organization "${org.name}" (${org.id}) with owner ${user.email}`);
}

seed().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
