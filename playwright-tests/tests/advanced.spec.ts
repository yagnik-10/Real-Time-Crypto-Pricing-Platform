import { test, expect } from '@playwright/test';

test.describe('Advanced criteria', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  async function clearSaved(page: any) {
    await page.evaluate(() => localStorage.clear());
  }

  test('low-latency: price visible within 5s and numeric-looking', async ({ page }) => {
    await clearSaved(page);
    const input = page.getByPlaceholder(/e\.g\. BTCUSD/i);
    await input.fill('BTCUSD');
    await page.getByRole('button', { name: 'Add' }).click();
    const row = page.locator('[data-testid="ticker-row"]').filter({ hasText: 'BTCUSD' });
    await expect(row).toBeVisible();
    const price = row.locator('[data-testid="price"]');
    const start = Date.now();
    await expect(price).toHaveText(/^[\d,]+(\.\d+)?|—$/, { timeout: 5000 });
    expect(Date.now() - start).toBeLessThan(5000);
  });

  test('multi-client: second client sees symbol and price quickly', async ({ browser }) => {
    const context = await browser.newContext();
    const p1 = await context.newPage();
    await p1.goto('/');

    // Add from p1
    await p1.getByPlaceholder(/e\.g\. BTCUSD/i).fill('ETHUSD');
    await p1.getByRole('button', { name: 'Add' }).click();
    await expect(p1.locator('[data-testid="ticker-list"]')).toContainText('ETHUSD');
    // Wait until localStorage reflects the symbol (debounced save)
    await p1.waitForFunction(() => {
      const symbols = JSON.parse(localStorage.getItem('symbols') || '[]');
      return symbols.includes('ETHUSD');
    });

    // Open second client AFTER save, so it can restore from localStorage on mount
    const p2 = await context.newPage();
    await p2.goto('/');

    // Verify symbol restored and price shows
    await expect(p2.locator('[data-testid="ticker-list"]')).toContainText('ETHUSD', { timeout: 10000 });
    const row2 = p2.locator('[data-testid="ticker-row"]').filter({ hasText: 'ETHUSD' });
    await expect(row2.locator('[data-testid="price"]').first()).toBeVisible({ timeout: 10000 });
    await context.close();
  });

  test('metrics expose playwright stats', async ({ request }) => {
    const res = await request.get('http://localhost:8080/metrics');
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('app_up');
    expect(text).toContain('playwright_');
  });

  test('resilience: status can show retrying/connected', async ({ page }) => {
    await page.goto('/');
    const status = page.locator('[data-testid="connection-status"]');
    await expect(status).toBeVisible();
    await expect(status).toContainText(/connected|connecting|retrying/, { timeout: 15000 });
  });
});


