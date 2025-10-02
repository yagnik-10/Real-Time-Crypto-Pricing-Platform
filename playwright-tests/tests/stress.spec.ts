import { test, expect } from '@playwright/test';

test.describe('Concurrency stress', () => {
  test('opens multiple tabs and validates all symbols render price or loading', async ({ browser }) => {
    const numTabs = Number(process.env.STRESS_TABS || 6);
    const symbols = (process.env.STRESS_SYMBOLS || 'BTCUSD,ETHUSD,SOLUSD').split(',');

    const context = await browser.newContext();
    const pages = await Promise.all(Array.from({ length: numTabs }, () => context.newPage()));
    await Promise.all(pages.map((p) => p.goto('/')));

    // Use first tab to add symbols so localStorage restores in others
    const p1 = pages[0];
    for (const sym of symbols) {
      await p1.getByPlaceholder(/e\.g\. BTCUSD/i).fill(sym);
      await p1.getByRole('button', { name: 'Add' }).click();
      // Respect app's 300ms add debounce
      await p1.waitForTimeout(400);
      // Wait until the symbol is persisted (debounced localStorage save)
      await p1.waitForFunction((s) => {
        const arr = JSON.parse(localStorage.getItem('symbols') || '[]');
        return Array.isArray(arr) && arr.includes(s);
      }, sym);
      const rowSymbol = p1.locator('[data-testid="ticker-row"] strong').filter({ hasText: sym });
      await expect(rowSymbol).toBeVisible({ timeout: 15000 });
    }
    // Wait for debounce save
    await p1.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem('symbols') || '[]');
      return Array.isArray(s) && s.length >= 3;
    });

    // Reload others to restore from localStorage
    await Promise.all(pages.slice(1).map((p) => p.reload()));

    // For every page and every symbol, expect either Loading… or a numeric price within 8s
    for (const p of pages) {
      for (const sym of symbols) {
        const row = p.locator('[data-testid="ticker-row"]').filter({ hasText: sym });
        await expect(row).toBeVisible();
        const price = row.locator('[data-testid="price"]');
        await expect(price).toHaveText(/Loading…|[\d,]+(?:\.\d+)?|—/, { timeout: 8000 });
      }
    }

    await context.close();
  });
});


