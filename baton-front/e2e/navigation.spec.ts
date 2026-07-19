import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('loads /flows page — Flow Builder renders', async ({ page }) => {
    await page.goto('/flows');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  });

  test('redirects / to /flows', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/flows/);
  });

  test('sidebar shows all navigation links', async ({ page }) => {
    await page.goto('/flows');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: /flow builder/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /workflow checker/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /connections/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /notifications/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
  });

  test('navigate to Connections via sidebar', async ({ page }) => {
    await page.goto('/flows');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: /connections/i }).click();
    await expect(page).toHaveURL(/\/connections/);
    await expect(page.getByRole('heading', { name: /connections/i })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to Workflow Checker via sidebar', async ({ page }) => {
    await page.goto('/flows');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: /workflow checker/i }).click();
    await expect(page).toHaveURL(/\/workflows/);
    await expect(page.getByRole('heading', { name: /maestro workflows/i })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to Notifications via sidebar', async ({ page }) => {
    await page.goto('/flows');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: /notifications/i }).click();
    await expect(page).toHaveURL(/\/notifications/);
  });

  test('navigate to Settings via sidebar', async ({ page }) => {
    await page.goto('/flows');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: /settings/i }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({ timeout: 10_000 });
  });

  test('header shows org switcher', async ({ page }) => {
    await page.goto('/flows');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /fluidlabs/i })).toBeVisible();
  });

  test('header shows user menu button', async ({ page }) => {
    await page.goto('/flows');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /open user menu/i })).toBeVisible();
  });

  test('sidebar collapse button works', async ({ page }) => {
    await page.goto('/flows');
    await page.waitForLoadState('networkidle');
    const collapseBtn = page.getByRole('button', { name: /collapse/i });
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();
    await expect(page.locator('aside').getByText('Flow Builder')).not.toBeVisible();
  });
});
