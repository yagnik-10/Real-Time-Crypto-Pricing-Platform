import { test, expect } from '@playwright/test';

// Opens 10 isolated tabs (contexts), adds 10 tickers in each (no repetition within a tab),
// and waits until each ticker shows a numeric price (not Loading or dash).
test('mega stress: 10 tabs x 10 symbols -> all show numeric prices', async ({ browser }) => {
  test.setTimeout(180000);
  const numTabs = 10;
  const symbols = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'ADAUSD', 'XRPUSD', 'DOTUSD', 'BNBUSD', 'DOGEUSD', 'AVAXUSD', 'MATICUSD'];

  const contexts = await Promise.all(Array.from({ length: numTabs }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map((c) => c.newPage()));

  // Navigate all pages
  await Promise.all(pages.map((p) => p.goto('/')));

  // For each page: add all symbols first, then wait for all prices in parallel
  for (const p of pages) {
    for (const sym of symbols) {
      const input = p.getByPlaceholder(/e\.g\. BTCUSD/i);
      await input.fill(sym);
      await p.getByRole('button', { name: 'Add' }).click();
      await p.waitForTimeout(400); // respect debounce
    }
    await Promise.all(symbols.map(async (sym) => {
      const row = p.locator('[data-testid="ticker-row"]').filter({ hasText: sym });
      await expect(row).toBeVisible({ timeout: 30000 });
      const price = row.locator('[data-testid="price"]');
      await expect(price).toHaveText(/[\d,]+(?:\.\d+)?/, { timeout: 60000 });
    }));
  }

  await Promise.all(contexts.map((c) => c.close()));
});


