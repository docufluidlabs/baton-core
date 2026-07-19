import { test as setup } from '@playwright/test';
import fs from 'fs';

const AUTH_FILE = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  const baseURL = process.env.E2E_BASE_URL!;
  const email = process.env.E2E_USER_EMAIL!;
  const password = process.env.E2E_USER_PASSWORD!;

  // If we have a saved session cookie, try to reuse it.
  if (fs.existsSync(AUTH_FILE)) {
    const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
    const state = JSON.parse(raw);
    const hasSession = state.cookies?.some(
      (c: { name: string }) => c.name === 'baton_session',
    );
    if (hasSession) {
      await page.context().addCookies(state.cookies);
      await page.goto(baseURL + '/flows');
      try {
        await page.getByRole('button', { name: /add automation/i }).waitFor({ timeout: 10_000 });
        await page.context().storageState({ path: AUTH_FILE });
        return;
      } catch {
        // Session expired — fall through to fresh login
      }
    }
  }

  // Fresh login: the app routes to /setup on a first-run install (no users
  // yet), otherwise to /signin.
  await page.goto(baseURL);
  await page.waitForURL(/\/(setup|signin)/, { timeout: 15_000 });

  if (page.url().includes('/setup')) {
    await page.getByLabel(/organization name/i).fill('E2E Org');
    await page.getByLabel(/your name/i).fill('E2E User');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /set up baton/i }).click();
  } else {
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
  }

  await page.waitForURL('**/flows', { timeout: 15_000 });
  await page.context().storageState({ path: AUTH_FILE });
});
