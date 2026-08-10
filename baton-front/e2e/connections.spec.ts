import { test, expect } from '@playwright/test';

test.describe('Connections Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/connections');
    await page.getByRole('heading', { name: /connections/i }).waitFor({ timeout: 10_000 });
  });

  test('shows page heading and description', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /connections/i }).first()).toBeVisible();
    await expect(page.getByText(/manage your connected platforms/i)).toBeVisible();
  });

  test('shows Docusign OAuth connection with Healthy status', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /docusign/i }).first()).toBeVisible();
    await expect(page.getByText('Healthy')).toBeVisible();
  });

  test('shows Check Connection Status and Disconnect buttons for OAuth', async ({ page }) => {
    await expect(page.getByRole('button', { name: /check connection status/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /disconnect/i })).toBeVisible();
  });

  test('shows Connected Platforms section with count', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /connected platforms/i })).toBeVisible();
    await expect(page.getByText(/platforms receiving webhooks/i)).toBeVisible();
  });

  test('shows Add Platform button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add platform/i })).toBeVisible();
  });

  test('lists installed platforms — Zoho CRM, HubSpot, Salesforce', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Zoho CRM' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'HubSpot test' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Salesforce Production' })).toBeVisible();
  });

  test('each platform has Create New Automation button', async ({ page }) => {
    const createButtons = page.getByRole('button', { name: /create new automation/i });
    await expect(createButtons).toHaveCount(3);
  });

  test('platforms show category and automation count', async ({ page }) => {
    await expect(page.getByText('CRM').first()).toBeVisible();
    await expect(page.getByText(/\d+ automation/i).first()).toBeVisible();
  });
});
