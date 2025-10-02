import type { ServiceImpl } from '@connectrpc/connect';
import type { PriceService } from '../gen/price/v1/price_connect.js';
import { AddTickerResponse, RemoveTickerResponse, PricePoint } from '../gen/price/v1/price_pb.js';
import { PlaywrightPool } from '../playwright/PlaywrightPool.js';

export type PoolStats = ReturnType<PlaywrightPool['getStats']>;
export let getPoolStats: (() => PoolStats | undefined) | undefined;

/**
 * Wire up the PriceService implementation with a shared PlaywrightPool.
 * The service maintains per-client desired symbol sets and reconciles them
 * without tearing down the stream.
 */
export function addServiceImpl(): ServiceImpl<typeof PriceService> {
  const pool = new PlaywrightPool(45000);
  // expose getter for /metrics
  getPoolStats = () => pool.getStats();
  // clientId -> set of symbols
  const clientToSymbols = new Map<string, Set<string>>();
  const clientToNotifier = new Map<string, () => void>();
  // symbol -> refcount
  const symbolRef = new Map<string, number>();

  // Maintain a global refcount per symbol for visibility and safety
  function inc(symbol: string) {
    const c = (symbolRef.get(symbol) ?? 0) + 1;
    symbolRef.set(symbol, c);
  }
  function dec(symbol: string) {
    const c = (symbolRef.get(symbol) ?? 0) - 1;
    if (c <= 0) symbolRef.delete(symbol);
    else symbolRef.set(symbol, c);
  }

  return {
    // addTicker: add a symbol for the client and trigger reconciliation.
    // Returns the last known price if available so the UI can render immediately.
    async addTicker(req: any) {
      const symbol = (req.symbol ?? '').toUpperCase();
      const clientId = req.clientId ?? '';
      if (!/^[A-Z]+USDT?$/.test(symbol)) {
        return new AddTickerResponse({ success: false, errorMessage: 'invalid symbol' });
      }
      let set = clientToSymbols.get(clientId);
      if (!set) { set = new Set(); clientToSymbols.set(clientId, set); }
      if (!set.has(symbol)) {
        set.add(symbol);
        inc(symbol);
        // eslint-disable-next-line no-console
        console.log('AddTicker', { clientId, symbol, set: Array.from(set) });
        try { clientToNotifier.get(clientId)?.(); } catch {}
      }
      // Wait a bit for the page to load and extract price
      let last = pool.getLastPrice(symbol);
      if (!last) {
        // Wait up to 2 seconds for price to be available
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          last = pool.getLastPrice(symbol);
          if (last) break;
        }
      }
      console.log('AddTicker getLastPrice', { symbol, last, hasPrice: !!last });
      return new AddTickerResponse({ success: true, errorMessage: '', initialPrice: last ? new PricePoint({ symbol, priceString: last }) : undefined });
    },
    // removeTicker: remove a symbol and trigger reconciliation.
    async removeTicker(req: any) {
      const symbol = (req.symbol ?? '').toUpperCase();
      const clientId = req.clientId ?? '';
      const set = clientToSymbols.get(clientId);
      if (set && set.delete(symbol)) {
        dec(symbol);
        // eslint-disable-next-line no-console
        console.log('RemoveTicker', { clientId, symbol, set: Array.from(set) });
        try { clientToNotifier.get(clientId)?.(); } catch {}
      }
      return new RemoveTickerResponse({ success: true, errorMessage: '' });
    },
    /**
     * Long-lived stream per client.
     * - Reconciles desired symbols dynamically while the stream stays open
     * - Fans out updates from a shared Playwright page to this client only
     */
    async *streamPrices(req: any) {
      const clientId = req.clientId ?? '';
      // eslint-disable-next-line no-console
      console.log('StreamPrices: client connected', { clientId, initial: req.initialSymbols });
      let set = clientToSymbols.get(clientId);
      if (!set) { 
        set = new Set(); 
        clientToSymbols.set(clientId, set); 
      }
      // Only add new symbols from initialSymbols, don't remove existing ones
      for (const s of (req.initialSymbols as string[])) {
        const sym = s.toUpperCase();
        if (!set.has(sym)) { 
          set.add(sym); 
          inc(sym); 
        }
      }
      // Minimal async queue implementation to bridge callback -> async iterator
      const queue: PricePoint[] = [];
      const waiters: Array<(v: IteratorResult<PricePoint>) => void> = [];
      let closed = false;
      const push = (p: PricePoint) => {
        const w = waiters.shift();
        if (w) w({ value: p, done: false }); else queue.push(p);
      };
      const next = (): Promise<IteratorResult<PricePoint>> => {
        if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
        if (closed) return Promise.resolve({ value: undefined as any, done: true });
        return new Promise<IteratorResult<PricePoint>>((res) => waiters.push(res));
      };

      const handlers = new Map<string, (d: { symbol: string; price: string; ts: number }) => void>();
      let reconciling = false;
      const reconcile = async () => {
        if (reconciling) return; reconciling = true;
        try {
          for (const sym of set) {
            if (!handlers.has(sym)) {
              const h = (d: { symbol: string; price: string; ts: number }) => {
                push(new PricePoint({ symbol: d.symbol, priceString: d.price }));
              };
              handlers.set(sym, h);
              await pool.subscribe(sym, h);
              // eslint-disable-next-line no-console
              console.log('subscribe', { clientId, symbol: sym });
              // Immediately push last known price so UI doesn't stay on loading
              const last = pool.getLastPrice(sym);
              if (last) {
                try {
                  push(new PricePoint({ symbol: sym, priceString: last }));
                } catch {}
              }
            }
          }
          for (const [sym, h] of Array.from(handlers.entries())) {
            if (!set.has(sym)) {
              pool.unsubscribe(sym, h);
              handlers.delete(sym);
              // eslint-disable-next-line no-console
              console.log('unsubscribe', { clientId, symbol: sym });
            }
          }
        } finally {
          reconciling = false;
        }
      };
      clientToNotifier.set(clientId, () => { void reconcile(); });
      await reconcile();
      
      // Ensure all subscribed symbols have initial prices pushed immediately
      const existingSymbols = clientToSymbols.get(clientId);
      if (existingSymbols && existingSymbols.size > 0) {
        // Push initial prices for all symbols to prevent loading states
        for (const sym of existingSymbols) {
          const last = pool.getLastPrice(sym);
          if (last) {
            try {
              push(new PricePoint({ symbol: sym, priceString: last }));
            } catch {}
          }
        }
        
        // Also push initial prices after a delay to catch any that weren't ready initially
        setTimeout(() => {
          for (const sym of existingSymbols) {
            const last = pool.getLastPrice(sym);
            if (last) {
              try {
                push(new PricePoint({ symbol: sym, priceString: last }));
              } catch {}
            }
          }
        }, 1000); // 1 second delay to ensure pages are fully ready
      }

      try {
        while (true) {
          const res = await next();
          if (res.done) break;
          yield res.value as PricePoint;
        }
      } finally {
        closed = true;
        // cleanup on stream close
        clientToNotifier.delete(clientId);
        for (const [sym, h] of handlers) {
          pool.unsubscribe(sym, h);
          dec(sym);
          // eslint-disable-next-line no-console
          console.log('unsubscribe', { clientId, symbol: sym });
        }
        // eslint-disable-next-line no-console
        console.log('StreamPrices: client disconnected', { clientId });
      }
    },
  };
}


