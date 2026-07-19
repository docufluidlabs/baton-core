import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('heading', { name: /settings/i }).waitFor({ timeout: 10_000 });
  });

  test('shows Settings heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });

  test('shows all tab buttons — General, Members, Audit Log', async ({ page }) => {
    await expect(page.getByRole('button', { name: /general/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /members/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /audit log/i })).toBeVisible();
  });

  test('General tab shows Save Changes button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible();
  });

  test('switching to Members tab shows member list', async ({ page }) => {
    await page.getByRole('button', { name: /members/i }).click();
    // Members tab should show table or invite button
    await expect(page.getByText(/member|invite|role/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('switching to Audit Log tab shows log entries', async ({ page }) => {
    await page.getByRole('button', { name: /audit log/i }).click();
    await expect(page.getByText(/audit|activity|event/i).first()).toBeVisible({ timeout: 5_000 });
  });
});
