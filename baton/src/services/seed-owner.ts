/**
 * Boot-time headless owner seed.
 *
 * When BATON_OWNER_EMAIL + BATON_OWNER_PASSWORD are set, the server seeds the
 * organization + owner account on startup using the same idempotent code path
 * as POST /api/auth/setup (and `npm run seed`). No-ops silently when the vars
 * are absent or any user already exists — so a pull-only Docker deployment can
 * provision its first login entirely from baton/.env.
 */
import env from '../env';
import { logger } from '../lib/logger';
import { needsSetup, performSetup } from './local-auth.service';

export async function seedOwnerFromEnv(): Promise<void> {
  const email = env.BATON_OWNER_EMAIL;
  const password = env.BATON_OWNER_PASSWORD;
  if (!email || !password) return;

  if (password.length < 8) {
    logger.error('BATON_OWNER_PASSWORD must be at least 8 characters — skipping owner seed');
    return;
  }

  if (!(await needsSetup())) {
    logger.debug('Owner seed skipped — users already exist');
    return;
  }

  const { user, org } = await performSetup({
    orgName: env.BATON_ORG_NAME,
    name: env.BATON_OWNER_NAME,
    email,
    password,
  });
  logger.info({ org: org.name, owner: user.email }, 'Seeded organization and owner from env');
}
