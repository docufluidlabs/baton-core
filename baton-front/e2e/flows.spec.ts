import { test, expect } from '@playwright/test';

test.describe('Flow Builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/flows');
    // Wait for the page to settle — Clerk refreshes the JWT, then SWR fetches data
    await page.waitForLoadState('networkidle');
  });

  test('renders ReactFlow canvas', async ({ page }) => {
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  });

  test('shows platform nodes', async ({ page }) => {
    // Platform nodes may take time to appear after data loads
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  });

  test('shows Add Automation button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add automation/i })).toBeVisible({ timeout: 20_000 });
  });

  test('shows ReactFlow controls (zoom in/out/fit)', async ({ page }) => {
    await expect(page.getByRole('button', { name: /zoom in/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /zoom out/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /fit view/i })).toBeVisible();
  });

  test('shows stats footer', async ({ page }) => {
    await expect(page.getByText(/\d+ connection/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/\d+ automation/)).toBeVisible();
  });

  test('clicking Add Automation opens sidebar with form', async ({ page }) => {
    await page.getByRole('button', { name: /add automation/i }).waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /add automation/i }).click();
    await expect(page.getByRole('heading', { name: /new automation/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/webhook source/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /create automation/i })).toBeVisible();
  });

  test('clicking Logs on a pair node opens Actions sidebar', async ({ page }) => {
    const logsBtn = page.getByRole('button', { name: /^logs$/i }).first();
    await logsBtn.waitFor({ timeout: 20_000 });
    await logsBtn.click();
    await expect(page.getByRole('heading', { name: /actions/i })).toBeVisible({ timeout: 10_000 });
  });

  test('clicking View Instances opens Instances sidebar', async ({ page }) => {
    const viewBtn = page.getByRole('button', { name: /view instances/i }).first();
    await viewBtn.waitFor({ timeout: 20_000 });
    await viewBtn.click();
    await expect(page.getByText(/instance/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
