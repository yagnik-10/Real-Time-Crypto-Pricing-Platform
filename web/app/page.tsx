'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { client, getClientId } from '../src/lib/connect-client';
import { PricePoint } from '../src/gen/price/v1/price_pb';

export default function Page() {
  const FLASH_MS = 1200;
  const [input, setInput] = useState('');
  const [symbols, setSymbols] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [justUpdated, setJustUpdated] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'retrying'>('idle');
  const [userInteracted, setUserInteracted] = useState(false);
  // Watchdog triggers a reconnect if no messages are seen for a while
  // If no messages are seen for this long, we force a reconnect
  const WATCHDOG_MS = 15000;
  const clientId = useMemo(getClientId, []);

  const sorted = useMemo(() => {
    return [...symbols]
      .map((s) => s.toUpperCase())
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
  }, [symbols]);

  // Keep latest symbols available for reconnects without restarting the effect
  // Keep the latest sorted symbols outside of React's effect deps so
  // reconnects reuse the current list without tearing down the effect
  const symbolsRef = useRef<string[]>([]);
  useEffect(() => {
    symbolsRef.current = sorted;
  }, [sorted]);

  // Restore saved symbols on mount (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('symbols');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const uniq = Array.from(new Set(parsed.map((s: any) => String(s || '').toUpperCase()).filter(Boolean)));
        if (uniq.length) setSymbols(uniq);
      }
    } catch {}
  }, []);

  // Debounce-save symbols to localStorage
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try { localStorage.setItem('symbols', JSON.stringify(symbols)); } catch {}
    }, 300);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [symbols]);

  // After stream connects, (re)ensure backend subscriptions for restored symbols
  useEffect(() => {
    if (status !== 'connected') return;
    if (!symbols.length) return;
    (async () => {
      // Wait for server readiness with longer timeout for multiple tickers
      const waitForServerReady = async () => {
        for (let i = 0; i < 50; i++) { // Max 5 seconds for multiple tickers
          try {
            const response = await fetch('http://localhost:8080/healthz');
            if (response.ok) return true;
          } catch {}
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
      };
      
      const serverReady = await waitForServerReady();
      if (!serverReady) {
        console.warn('Server not ready after 5 seconds, proceeding anyway');
      }
      
      await Promise.all(symbols.map(async (sym) => {
        setLoading((prev) => ({ ...prev, [sym]: true }));
        try {
          const res = await client.addTicker({ clientId, symbol: sym });
          if (res.initialPrice) {
            const p = res.initialPrice.priceString;
            setPrices((prev) => ({ ...prev, [sym]: p }));
            setLoading((prev) => ({ ...prev, [sym]: false }));
          } else {
            // Keep loading=true until first pushed price arrives via stream
          }
        } catch (error) {
          console.warn('Failed to add ticker', sym, error);
          // Keep loading=true; stream may still deliver first price shortly
        }
      }));
    })();
  }, [status, symbols, clientId, userInteracted]);

  useEffect(() => {
    let cancelled = false;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    // Exponential backoff state for reconnects
    let retryMs = 1000;
    let lastMsgTs = Date.now();
    let reconnectRequested = false;

    // Schedule a reconnect with capped exponential backoff
    function scheduleRetry() {
      if (cancelled) return;
      setStatus('retrying');
      // eslint-disable-next-line no-console
      console.warn(`stream closed; retrying in ${retryMs}ms`);
      const delay = retryMs;
      retryMs = Math.min(retryMs * 2, 10000);
      setTimeout(() => {
        if (!cancelled) {
          run();
        }
      }, delay);
    }

    // Establish the stream and drive the watchdog
    async function run() {
      setStatus('connecting');
      reconnectRequested = false;
      try {
        // Start stream with current symbols to ensure immediate subscription on connect
        // eslint-disable-next-line no-console
        console.log('open stream', { clientId, initialSymbols: symbolsRef.current });
        const stream = client.streamPrices({ clientId, initialSymbols: symbolsRef.current });
        setStatus('connected');
        retryMs = 1000; // reset backoff on successful connect
        lastMsgTs = Date.now();
        // Start watchdog that asks for reconnect if no messages arrive for a while
        if (watchdog) clearInterval(watchdog);
        watchdog = setInterval(() => {
          if (Date.now() - lastMsgTs > WATCHDOG_MS) {
            // eslint-disable-next-line no-console
            console.warn('watchdog timeout; requesting reconnect');
            reconnectRequested = true;
          }
        }, Math.min(5000, WATCHDOG_MS / 3));

        // eslint-disable-next-line no-console
        console.log('Stream started, waiting for price updates...');
        // Consume server-pushed updates; throw to reconnect on watchdog request
        for await (const p of stream) {
          if (cancelled) break;
          if (reconnectRequested) throw new Error('watchdog reconnect');
          lastMsgTs = Date.now();
          // eslint-disable-next-line no-console
          console.log('Received price update:', p.symbol, '→', p.priceString);
          setPrices((prev) => ({ ...prev, [p.symbol]: p.priceString }));
          setLoading((prev) => ({ ...prev, [p.symbol]: false }));
          
          const ts = Date.now();
          setJustUpdated((prev) => ({ ...prev, [p.symbol]: ts }));
          setTimeout(() => {
            setJustUpdated((prev) => {
              if ((prev[p.symbol] ?? 0) !== ts) return prev;
              const next = { ...prev };
              delete next[p.symbol];
              return next;
            });
          }, FLASH_MS);
        }
        // Stream ended without error
        if (!cancelled) scheduleRetry();
      } catch (e) {
        if (!cancelled) {
          scheduleRetry();
        }
      } finally {
        if (watchdog) {
          clearInterval(watchdog);
          watchdog = undefined;
        }
      }
    }

    run();
    return () => {
      cancelled = true;
      if (watchdog) clearInterval(watchdog);
    };
  }, [clientId]); // Only depend on clientId to maintain stable stream connection

  // Simple debounce to avoid rapid duplicate additions
  const lastAddRef = useRef<number>(0);

  async function addTicker() {
    const sym = input.trim().toUpperCase();
    if (!sym || !/^[A-Z]+USDT?$/.test(sym)) return;
    if (symbols.includes(sym)) return;
    const now = Date.now();
    if (now - (lastAddRef.current || 0) < 300) return;
    lastAddRef.current = now;
    setSymbols((s) => [...s, sym]);
    setLoading((prev) => ({ ...prev, [sym]: true }));
    // eslint-disable-next-line no-console
    console.log('addTicker', sym);
    try {
      const res = await client.addTicker({ clientId, symbol: sym });
      if (res.initialPrice) {
        const p = res.initialPrice.priceString;
        setPrices((prev) => ({ ...prev, [sym]: p }));
        setLoading((prev) => ({ ...prev, [sym]: false }));
        const ts = Date.now();
        setJustUpdated((prev) => ({ ...prev, [sym]: ts }));
        setTimeout(() => {
          setJustUpdated((prev) => {
            if ((prev[sym] ?? 0) !== ts) return prev;
            const next = { ...prev };
            delete next[sym];
            return next;
          });
        }, FLASH_MS);
      }
      // If no initialPrice, keep loading=true; the stream will provide it
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('addTicker failed', e);
      // Keep loading=true; the stream will provide the first price once ready
    }
    setInput('');
  }

  async function removeTicker(sym: string) {
    setSymbols((s) => s.filter((x) => x !== sym));
    // eslint-disable-next-line no-console
    console.log('removeTicker', sym);
    await client.removeTicker({ clientId, symbol: sym });
  }

  return (
    <main className="container">
      <div className="siteHeader">
        <img
          className="logoBig"
          src="/coinflow.png"
          alt="Coinflow"
          onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/_next/cache/coinflow.png'; }}
        />
        <h1 className="siteTitle">Real‑Time Crypto Prices</h1>
      </div>
      <div className="card">
        <div className="header">
          <div className="title"></div>
          <form className="controls" onSubmit={(e) => { e.preventDefault(); void addTicker(); }}>
            <input
              className="input"
              placeholder="e.g. BTCUSD"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className="button">Add</button>
          </form>
        </div>
        <div className="status" data-testid="connection-status">
          <span className={`dot ${status === 'connected' ? 'connected' : status === 'retrying' ? 'retrying' : ''}`} />
          <span>Status: {status}</span>
          {symbols.length > 0 && (
            <span className="pill">{symbols.length} tickers</span>
          )}
        </div>
        <div className="examples">
          <div>Try adding these popular pairs:</div>
          <div className="chips">
            {[
              'BTCUSD','ETHUSD','SOLUSD','XRPUSD','ADAUSD','DOGEUSD','AVAXUSD','DOTUSD','MATICUSD','LTCUSD',
              'BCHUSD','LINKUSD','ATOMUSD','NEARUSD','FILUSD','APTUSD','ARBUSD','OPUSD','SUIUSD','PEPEUSD'
            ].map((ex) => (
              <span key={ex} className="chip" onClick={() => setInput(ex)}>
                <span className="sym">{ex}</span>
                <span className="name">{ex.replace('USD',' / USD')}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="list" data-testid="ticker-list">
          {sorted.map((s) => (
            <div className="row" key={s} data-testid="ticker-row">
              <div className="cell symbol">{s}</div>
              <div className="cell price" key={`${s}-${justUpdated[s] ?? 0}`} data-testid="price">
                <span className={`priceValue ${justUpdated[s] ? 'priceFlash' : ''}`}>
                  {loading[s] && prices[s] == null ? (
                    <span data-testid="loading" style={{ display: 'inline-block' }}>
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, marginRight: 4,
                        borderRadius: '50%', background: '#999', animation: 'pulse 1s infinite'
                      }} />
                      <span>Loading…</span>
                    </span>
                  ) : (
                    prices[s] != null ? `$${prices[s]}` : '—'
                  )}
                </span>
              </div>
              <div className="cell actions">
                <button className="remove" data-testid="remove-ticker" onClick={() => removeTicker(s)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <div className="disclaimer">
          Prices are sourced from TradingView free data and may be delayed or inaccurate.
          This app is for demonstration only and not for trading decisions.
        </div>
      </div>
    </main>
  );
}


