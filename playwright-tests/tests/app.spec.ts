import { test, expect } from '@playwright/test';

test.describe('Cryptocurrency Price Tracker App', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to page before each test
    await page.goto('/');
  });

  // Helpers for robust and readable tests
  async function clearSaved(page: any) {
    await page.evaluate(() => localStorage.clear());
  }

  async function getSaved(page: any): Promise<string[]> {
    return await page.evaluate(() => JSON.parse(localStorage.getItem('symbols') || '[]'));
  }

  async function addTickerUI(page: any, symbol: string) {
    const input = page.getByPlaceholder(/e\.g\. BTCUSD/i);
    await input.fill(symbol);
    await page.getByRole('button', { name: 'Add' }).click();
    // Wait until the row with this symbol appears
    const symbolStrong = page.locator('[data-testid="ticker-row"] strong', { hasText: symbol.trim().toUpperCase() });
    await symbolStrong.waitFor({ state: 'visible' });
    // Respect app's 300ms add debounce to avoid dropping subsequent adds
    await page.waitForTimeout(400);
  }

  async function removeTickerUI(page: any, symbol: string) {
    const row = page.locator('[data-testid="ticker-row"]').filter({ hasText: symbol.toUpperCase() });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('[data-testid="ticker-list"]')).not.toContainText(symbol.toUpperCase());
  }

  test('should load the main page', async ({ page }) => {
    await page.goto('/');
    
    // Check if the main heading is present
    await expect(page.getByRole('heading', { name: /crypto/i })).toBeVisible();
  });

  test('should display connection status', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the connection status to appear
    await expect(page.locator('[data-testid="connection-status"]')).toBeVisible();
    
    // Initially should show connecting or connected status
    const status = page.locator('[data-testid="connection-status"]');
    await expect(status).toContainText(/connecting|connected|idle/);
  });

  test('should add a cryptocurrency ticker', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the input field to be visible
    const input = page.getByPlaceholder(/e\.g\. BTCUSD/i);
    await expect(input).toBeVisible();
    
    // Add a ticker
    await input.fill('BTCUSD');
    await page.getByRole('button', { name: 'Add' }).click();
    
    // Check if the ticker appears in the list
    await expect(page.locator('[data-testid="ticker-list"]')).toContainText('BTCUSD');
  });

  test('should remove a cryptocurrency ticker', async ({ page }) => {
    await page.goto('/');
    
    // Add a ticker first
    const input = page.getByPlaceholder(/e\.g\. BTCUSD/i);
    await input.fill('ETHUSD');
    await page.getByRole('button', { name: 'Add' }).click();
    
    // Wait for ticker to appear
    await expect(page.locator('[data-testid="ticker-list"]')).toContainText('ETHUSD');
    
    // Find and click the remove button for ETHUSD
    const removeButton = page.locator('[data-testid="ticker-row"]').filter({ hasText: 'ETHUSD' }).getByRole('button', { name: 'Remove' });
    await removeButton.click();
    
    // Check if the ticker is removed
    await expect(page.locator('[data-testid="ticker-list"]')).not.toContainText('ETHUSD');
  });

  test('should display price updates', async ({ page }) => {
    await page.goto('/');
    
    // Add a ticker
    const input = page.getByPlaceholder(/e\.g\. BTCUSD/i);
    await input.fill('BTCUSD');
    await page.getByRole('button', { name: 'Add' }).click();
    
    // Wait for the ticker to appear and potentially show a price
    await expect(page.locator('[data-testid="ticker-list"]')).toContainText('BTCUSD');
    
    // Wait for either a price or loading state
    const tickerRow = page.locator('[data-testid="ticker-row"]').filter({ hasText: 'BTCUSD' });
    await expect(tickerRow).toBeVisible();
    
    // Check if price is displayed (price should be visible after loading)
    const priceElement = tickerRow.locator('[data-testid="price"]');
    await expect(priceElement).toBeVisible();
  });

  test('should persist symbols in localStorage', async ({ page }) => {
    await clearSaved(page);
    await addTickerUI(page, 'BTCUSD');
    await addTickerUI(page, 'ETHUSD');

    // Wait until both appear in localStorage (debounced save)
    await page.waitForFunction(() => {
      const symbols = JSON.parse(localStorage.getItem('symbols') || '[]');
      return symbols.includes('BTCUSD') && symbols.includes('ETHUSD');
    });

    const savedSymbols = await getSaved(page);
    expect(savedSymbols).toEqual(expect.arrayContaining(['BTCUSD', 'ETHUSD']));
  });

  test('should restore symbols from localStorage on page reload', async ({ page }) => {
    await clearSaved(page);
    await addTickerUI(page, 'SOLUSD');

    await page.waitForFunction(() => {
      const symbols = JSON.parse(localStorage.getItem('symbols') || '[]');
      return symbols.includes('SOLUSD');
    });

    await page.reload();
    await expect(page.locator('[data-testid="ticker-list"]')).toContainText('SOLUSD', { timeout: 10000 });
  });

  test('should handle invalid ticker symbols', async ({ page }) => {
    await page.goto('/');
    
    const input = page.getByPlaceholder(/e\.g\. BTCUSD/i);
    
    // Try to add an invalid symbol
    await input.fill('INVALID');
    await page.getByRole('button', { name: 'Add' }).click();
    
    // The invalid symbol should not appear in the list
    await expect(page.locator('[data-testid="ticker-list"]')).not.toContainText('INVALID');
  });

  test('should sort tickers alphabetically', async ({ page }) => {
    await clearSaved(page);
    await addTickerUI(page, 'ETHUSD');
    await addTickerUI(page, 'BTCUSD');
    await addTickerUI(page, 'ADAUSD');

    const tickerSymbols = page.locator('[data-testid="ticker-row"] strong');
    const symbolTexts = await tickerSymbols.allTextContents();
    const sortedTickers = ['ADAUSD', 'BTCUSD', 'ETHUSD'];
    expect(symbolTexts).toEqual(sortedTickers);
  });

  test('should normalize input and prevent duplicates', async ({ page }) => {
    await clearSaved(page);
    await addTickerUI(page, '  ethusd  ');
    // Try to add duplicate with different casing
    const input = page.getByPlaceholder(/e\.g\. BTCUSD/i);
    await input.fill('ETHUSD');
    await page.getByRole('button', { name: 'Add' }).click();

    // Only one ETHUSD row should exist
    const rows = page.locator('[data-testid="ticker-row"] strong', { hasText: 'ETHUSD' });
    await expect(rows).toHaveCount(1);
    // Wait until localStorage contains the normalized symbol
    await page.waitForFunction(() => {
      const symbols = JSON.parse(localStorage.getItem('symbols') || '[]');
      return symbols.includes('ETHUSD');
    });
    const saved = await getSaved(page);
    expect(saved.filter(s => s === 'ETHUSD')).toHaveLength(1);
  });

  test('should reject invalid symbols', async ({ page }) => {
    await clearSaved(page);
    const input = page.getByPlaceholder(/e\.g\. BTCUSD/i);
    for (const invalid of ['BTC', 'BTCUS', 'ETH-USD', '123USD']) {
      await input.fill(invalid);
      await page.getByRole('button', { name: 'Add' }).click();
    }
    // None of the invalid symbols should appear
    await expect(page.locator('[data-testid="ticker-list"]')).not.toContainText('BTC ');
    await expect(page.locator('[data-testid="ticker-list"]')).not.toContainText('ETH-USD');
  });

  test('should rate-limit rapid duplicate adds of the same symbol', async ({ page }) => {
    await clearSaved(page);
    const input = page.getByPlaceholder(/e\.g\. BTCUSD/i);
    await input.fill('SOLUSD');
    await page.getByRole('button', { name: 'Add' }).click();
    // Immediately try to add again (within debounce window)
    await page.getByRole('button', { name: 'Add' }).click();
    // Expect only one SOLUSD row
    const rows = page.locator('[data-testid="ticker-row"] strong', { hasText: 'SOLUSD' });
    await expect(rows).toHaveCount(1);
  });

  test('removing a ticker persists across reload', async ({ page }) => {
    await clearSaved(page);
    await addTickerUI(page, 'ADAUSD');
    await removeTickerUI(page, 'ADAUSD');
    // Wait for localStorage (debounced save) to reflect removal before reload
    await page.waitForFunction(() => {
      const symbols = JSON.parse(localStorage.getItem('symbols') || '[]');
      return !symbols.includes('ADAUSD');
    });
    await page.reload();
    await expect(page.locator('[data-testid="ticker-list"]')).not.toContainText('ADAUSD');
    const saved = await getSaved(page);
    expect(saved).not.toContain('ADAUSD');
  });
});
