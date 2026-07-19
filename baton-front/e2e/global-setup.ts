import { test as setup, expect } from '@playwright/test';
import fs from 'fs';

const AUTH_FILE = 'e2e/.auth/user.json';

setup('authenticate via Clerk', async ({ page }) => {
  const baseURL = process.env.E2E_BASE_URL!;
  const baseHost = new URL(baseURL).hostname;

  // If we have a saved session, try to reuse it
  if (fs.existsSync(AUTH_FILE)) {
    const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
    const state = JSON.parse(raw);
    // Check if there's a __session cookie for the target domain
    const hasSession = state.cookies?.some(
      (c: { name: string; domain: string }) =>
        c.name === '__session' && c.domain.includes(baseHost),
    );
    if (hasSession) {
      // Add cookies to this context and check if session is still valid
      await page.context().addCookies(state.cookies);
      await page.goto(baseURL + '/flows');
      // If we see the app (not sign-in), session is valid — save and done
      try {
        await page.getByRole('button', { name: /add automation/i }).waitFor({ timeout: 10_000 });
        await page.context().storageState({ path: AUTH_FILE });
        return;
      } catch {
        // Session expired — fall through to login
      }
    }
  }

  // Fresh login
  await page.goto(baseURL);

  // Wait for Clerk sign-in UI
  await page.getByRole('heading', { name: /sign in/i }).waitFor({ timeout: 15_000 });

  // Fill email + password (same page in this Clerk config)
  await page.getByRole('textbox', { name: /email address/i }).fill(process.env.E2E_USER_EMAIL!);
  await page.getByRole('textbox', { name: /password/i }).fill(process.env.E2E_USER_PASSWORD!);
  await page.getByRole('button', { name: /continue/i }).click();

  // Handle potential 2FA step
  try {
    await page.waitForURL('**/flows', { timeout: 10_000 });
  } catch {
    const url = page.url();
    if (url.includes('factor-two')) {
      // Wait for manual 2FA completion (up to 60s)
      await page.waitForURL('**/flows', { timeout: 60_000 });
    }
  }

  await expect(page.locator('body')).not.toContainText('Sign in to Baton');
  await page.context().storageState({ path: AUTH_FILE });
});
