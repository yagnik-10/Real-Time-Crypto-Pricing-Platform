import { test, expect } from '@playwright/test';

test('basic page load test', async ({ page }) => {
  await page.goto('/');
  
  // Wait for the page to load and check if the main heading is present
  await expect(page.getByRole('heading', { name: /crypto/i })).toBeVisible();
  
  // Check if the input field is present
  await expect(page.getByPlaceholder(/e\.g\. BTCUSD/i)).toBeVisible();
});

test('should add a cryptocurrency ticker', async ({ page }) => {
  await page.goto('/');
  
  // Wait for the input field to be visible
  const input = page.getByPlaceholder(/e\.g\. BTCUSD/i);
  await expect(input).toBeVisible();
  
  // Add a ticker
  await input.fill('BTCUSD');
  await page.getByRole('button', { name: 'Add' }).click();
  
  // Wait for the ticker to appear in the list
  await expect(page.locator('[data-testid="ticker-list"]')).toContainText('BTCUSD', { timeout: 10000 });
});

test('should display connection status', async ({ page }) => {
  await page.goto('/');
  
  // Wait for the connection status to appear
  await expect(page.locator('[data-testid="connection-status"]')).toBeVisible();
  
  // Initially should show connecting or connected status
  const status = page.locator('[data-testid="connection-status"]');
  await expect(status).toContainText(/connecting|connected|idle/);
});
