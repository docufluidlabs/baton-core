import { test, expect } from '@playwright/test';

test.describe('Workflows Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workflows');
    await page.getByRole('heading', { name: /maestro workflows/i }).waitFor({ timeout: 10_000 });
  });

  test('shows page heading and description', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /maestro workflows/i })).toBeVisible();
    await expect(page.getByText(/sync workflows from docusign maestro/i)).toBeVisible();
  });

  test('shows Sync from DocuSign button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /sync from docusign/i })).toBeVisible();
  });

  test('page shows either workflow cards or empty state', async ({ page }) => {
    // Depending on data, we either see workflow cards or "No workflows synced"
    const hasWorkflows = page.locator('[class*="border"][class*="rounded"]').first();
    const emptyState = page.getByText(/no workflows synced/i);
    await expect(hasWorkflows.or(emptyState)).toBeVisible({ timeout: 10_000 });
  });
});
