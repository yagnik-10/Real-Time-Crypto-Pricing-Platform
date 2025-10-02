import { test, expect } from '@playwright/test';

test.describe('API Endpoints', () => {
  test('should respond to health check', async ({ request }) => {
    const response = await request.get('http://localhost:8080/healthz');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('ok', true);
    expect(data).toHaveProperty('timestamp');
  });

  test('should provide metrics endpoint', async ({ request }) => {
    const response = await request.get('http://localhost:8080/metrics');
    expect(response.status()).toBe(200);
    
    const text = await response.text();
    expect(text).toContain('app_up');
    expect(text).toContain('playwright_');
  });


  test('should handle add ticker request', async ({ request }) => {
    const response = await request.post('http://localhost:8080/price.v1.PriceService/AddTicker', {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000'
      },
      data: {
        symbol: 'BTCUSD',
        clientId: 'test-client-123'
      }
    });
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('success');
  });

  test('should handle remove ticker request', async ({ request }) => {
    // First add a ticker
    await request.post('http://localhost:8080/price.v1.PriceService/AddTicker', {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000'
      },
      data: {
        symbol: 'ETHUSD',
        clientId: 'test-client-123'
      }
    });
    
    // Then remove it
    const response = await request.post('http://localhost:8080/price.v1.PriceService/RemoveTicker', {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000'
      },
      data: {
        symbol: 'ETHUSD',
        clientId: 'test-client-123'
      }
    });
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('success', true);
  });

  test('should reject invalid ticker symbols', async ({ request }) => {
    const response = await request.post('http://localhost:8080/price.v1.PriceService/AddTicker', {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000'
      },
      data: {
        symbol: 'INVALID',
        clientId: 'test-client-123'
      }
    });
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    // The API returns errorMessage for invalid symbols, not success: false
    expect(data).toHaveProperty('errorMessage');
    expect(data.errorMessage).toBe('invalid symbol');
  });

  test('should handle multiple tickers for same client', async ({ request }) => {
    const clientId = 'test-client-multi';
    const symbols = ['BTCUSD', 'ETHUSD', 'SOLUSD'];
    
    // Add multiple tickers
    for (const symbol of symbols) {
      const response = await request.post('http://localhost:8080/price.v1.PriceService/AddTicker', {
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:3000'
        },
        data: {
          symbol,
          clientId
        }
      });
      
      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('success', true);
    }
    
    // Clean up - remove all tickers
    for (const symbol of symbols) {
      await request.post('http://localhost:8080/price.v1.PriceService/RemoveTicker', {
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:3000'
        },
        data: {
          symbol,
          clientId
        }
      });
    }
  });
});
