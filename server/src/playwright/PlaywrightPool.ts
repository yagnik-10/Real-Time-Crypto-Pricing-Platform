import { chromium, Browser, BrowserContext, Page } from 'playwright';

/**
 * PlaywrightPool
 *
 * Responsibility:
 * - Own a single headed Chromium instance and one page per unique symbol
 * - Share page updates (fan-out) with all subscribers for that symbol
 * - Perform idle cleanup and simple capacity control (LRU eviction)
 * - Provide lightweight stats for observability (/metrics)
 */

type Subscriber = (data: { symbol: string; price: string; ts: number }) => void;

export class PlaywrightPool {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private symbolToPage = new Map<string, Page>();
  private symbolToSubs = new Map<string, Set<Subscriber>>();
  private symbolToIdleTimer = new Map<string, NodeJS.Timeout>();
  private symbolToLast = new Map<string, string>();
  private lastUsed = new Map<string, number>();
  // Open queue (prioritized) with reasonable concurrency for multiple tickers
  private openConcurrency = Number(process.env.PLAYWRIGHT_OPEN_CONCURRENCY || 5);
  private inFlightOpens = 0;
  private queuedJobs = new Map<string, { symbol: string; priority: number; enqueuedAt: number }>();
  private queueByPriority: Array<Array<string>> = [[], [], []]; // 0: hot, 1: warm, 2: cold
  private warmUntil = new Map<string, number>();
  private maxQueue = 100; // soft cap
  // TradingView screener fast-path (shared tab)
  private screenerPage: Page | null = null;
  private screenerCache = new Map<string, { price: string; ts: number }>();
  private screenerCacheTtlMs = 10000;

  /**
   * @param idleMs     how long a symbol can remain without subscribers before its page is closed
   * @param maxPages   soft cap on number of open pages; if reached, an idle page is evicted (LRU)
   */
  constructor(private idleMs: number = 45000, private maxPages: number = Number(process.env.PLAYWRIGHT_MAX_PAGES || 30)) {}

  async ensure(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
      this.context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
      });
      try {
        await this.context.route('**/*', (route) => {
          const type = route.request().resourceType();
          if (type === 'image' || type === 'media' || type === 'font') return route.abort();
          const url = route.request().url();
          if (/googletagmanager|google-analytics|doubleclick|adsystem|adservice/i.test(url)) return route.abort();
          return route.continue();
        });
      } catch {}
      // eslint-disable-next-line no-console
      console.log('Playwright: browser started (headed)');
    }
  }

  private async ensureScreenerPage(): Promise<Page> {
    await this.ensure();
    if (this.screenerPage && !this.screenerPage.isClosed()) return this.screenerPage;
    if (!this.context) throw new Error('Context not ready');
    const page = await this.context.newPage();
    // eslint-disable-next-line no-console
    console.log('opening TradingView screener page');
    await page.goto('https://www.tradingview.com/markets/cryptocurrencies/prices-all/', { waitUntil: 'networkidle' });
    this.screenerPage = page;
    return page;
  }

  private extractNumber(text: string): string {
    const m = (text || '').trim().match(/(?:\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/);
    return m ? m[0] : '';
  }

  private async fetchFromScreener(symbol: string): Promise<string | undefined> {
    const upper = symbol.toUpperCase();
    const cached = this.screenerCache.get(upper);
    const now = Date.now();
    if (cached && now - cached.ts <= this.screenerCacheTtlMs) return cached.price;
    try {
      const page = await this.ensureScreenerPage();
      const price = await page.evaluate((sym: string) => {
        const selectorA = `a[href*="/symbols/${sym}/?exchange=CRYPTO"], a[href*="/symbols/${sym}/?exchange=BINANCE"]`;
        const link = document.querySelector(selectorA) as HTMLAnchorElement | null;
        const row = (link && (link.closest('tr') || link.closest('[role="row"]') || link.parentElement)) as Element | null;
        if (!row) return '';
        const nodes = Array.from(row.querySelectorAll('td,div,span')) as HTMLElement[];
        const re = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/;
        type Cand = { val: string; score: number };
        const cands: Cand[] = [];
        for (const el of nodes) {
          const t = (el.textContent || '').trim();
          if (!t || /%/.test(t)) continue; // skip percentage columns
          const m = re.exec(t);
          if (!m) continue;
          const token = m[0];
          const hasCurrency = /USD/i.test(t);
          const hasPunct = /[.,]/.test(token);
          const longish = token.replace(/[,]/g, '').length >= 4;
          let score = 0;
          if (hasCurrency) score += 3;
          if (hasPunct) score += 2;
          if (longish) score += 1;
          // Penalize tiny integers (likely rank)
          if (!hasPunct && !hasCurrency && token.length <= 2) score -= 3;
          cands.push({ val: token, score });
        }
        if (!cands.length) return '';
        cands.sort((a, b) => b.score - a.score);
        return cands[0].val;
      }, upper);
      if (price) {
        this.screenerCache.set(upper, { price, ts: now });
        // eslint-disable-next-line no-console
        console.log('screener_hit', upper, price);
        return price;
      }
      // eslint-disable-next-line no-console
      console.log('screener_miss', upper);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('screener_error', symbol, String(e));
    }
    return undefined;
  }

  async subscribe(symbol: string, onData: Subscriber): Promise<void> {
    await this.ensure();
    const upper = symbol.toUpperCase();
    const subs = this.symbolToSubs.get(upper) ?? new Set<Subscriber>();
    subs.add(onData);
    this.symbolToSubs.set(upper, subs);
    this.lastUsed.set(upper, Date.now());
    clearTimeout(this.symbolToIdleTimer.get(upper) as NodeJS.Timeout);
    // Fast-path: try screener immediately
    (async () => {
      const p = await this.fetchFromScreener(upper);
      if (p) {
        this.symbolToLast.set(upper, p);
        const data = { symbol: upper, price: p, ts: Date.now() };
        const s = this.symbolToSubs.get(upper);
        if (s) s.forEach((fn) => fn(data));
      }
    })().catch(() => {});
    if (!this.symbolToPage.has(upper)) this.enqueueOpen(upper, 0);
  }

  unsubscribe(symbol: string, onData: Subscriber): void {
    const upper = symbol.toUpperCase();
    const subs = this.symbolToSubs.get(upper);
    if (!subs) return;
    subs.delete(onData);
    if (subs.size === 0) {
      // Mark warm window so re-subscribes get priority over cold
      this.warmUntil.set(upper, Date.now() + this.idleMs);
      const timer = setTimeout(() => this.closePage(upper).catch(() => {}), this.idleMs);
      this.symbolToIdleTimer.set(upper, timer);
    }
  }

  private async openPage(symbol: string): Promise<void> {
    if (!this.context) throw new Error('Context not ready');
    // Lightweight capacity control: try to evict an unsubscribed, oldest page
    // Capacity guard – keep resource usage predictable on many symbols
    if (this.symbolToPage.size >= this.maxPages) {
      let victim: string | undefined;
      let oldest = Number.POSITIVE_INFINITY;
      for (const [sym, page] of this.symbolToPage.entries()) {
        const subs = this.symbolToSubs.get(sym);
        const last = this.lastUsed.get(sym) ?? 0;
        if ((subs == null || subs.size === 0) && last < oldest) {
          oldest = last;
          victim = sym;
        }
      }
      if (victim) {
        // eslint-disable-next-line no-console
        console.warn('Playwright: evicting least-recently-used idle page', victim);
        await this.closePage(victim).catch(() => {});
      } else {
        // eslint-disable-next-line no-console
        console.warn('Playwright: maxPages reached and no idle pages to evict');
      }
    }
    const url = `https://www.tradingview.com/symbols/${symbol}/?exchange=BINANCE`;
    const page = await this.context.newPage();
    try {
      page.on('console', (msg) => {
        // eslint-disable-next-line no-console
        console.log('[page]', symbol, msg.text());
        try {
          const text = msg.text() || '';
          const m = text.match(/^PP_PRICE\s+(.+)/);
          if (m && m[1]) {
            const price = String(m[1]).trim();
            if (price) {
              const data = { symbol, price, ts: Date.now() };
              this.symbolToLast.set(symbol, price);
              this.lastUsed.set(symbol, Date.now());
              const subs = this.symbolToSubs.get(symbol);
              if (subs) subs.forEach((fn) => fn(data));
            }
          }
        } catch {}
      });
    } catch {}
    // expose before navigation so init script can notify at document-start
    // Expose before navigation so the injected script can call it at document-start
    await page.exposeFunction('notifyPrice', (price: string) => {
      if (!price || !String(price).trim()) return; // ignore empty updates
      // eslint-disable-next-line no-console
      console.log('notifyPrice called for', symbol, 'with price:', price);
      const data = { symbol, price, ts: Date.now() };
      this.symbolToLast.set(symbol, price);
      this.lastUsed.set(symbol, Date.now());
      const subs = this.symbolToSubs.get(symbol);
      if (subs) {
        // eslint-disable-next-line no-console
        console.log('Notifying', subs.size, 'subscribers for', symbol);
        subs.forEach((fn) => fn(data));
      }
    });
    
    // Inject script BEFORE navigation so it runs at document-start
    // Inject a MutationObserver that pushes updates without polling
    await page.addInitScript({ content: `(() => {
      console.log('Playwright script injected for', '${symbol}');
      function qs(sel) { return document.querySelector(sel); }
      var selectors = [
        '.tv-symbol-price-quote__value.js-symbol-last',
        '.tv-symbol-price-quote__value',
        '[data-field="last"]',
        '[data-name="price"]',
        '.last-price-value',
        '.js-symbol-last'
      ];
      // Match a numeric price substring inside text (no anchors) - improved to handle comma-separated numbers
      var priceRegex = /(?:\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/;
      function plausible(val){
        var t = (val||'').trim();
        var m = t.match(priceRegex);
        if (!m) return false;
        var num = Number(m[0].replace(/,/g,''));
        if (!isFinite(num)) return false;
        return num > 0 && num < 10000000;
      }
      function numericCandidate() {
        var all = Array.from(document.querySelectorAll('span,div'));
        for (var i = 0; i < all.length; i++) {
          var t = (all[i].textContent || '').trim();
          if (priceRegex.test(t) && plausible(t)) return all[i];
        }
        return null;
      }
      function findNode() {
        for (var i = 0; i < selectors.length; i++) {
          var n = qs(selectors[i]);
          if (n) {
            console.log('Found price element with selector:', selectors[i], 'value:', n.textContent);
            return n;
          }
        }
        var candidate = numericCandidate();
        if (candidate) {
          console.log('Found price element with numeric search, value:', candidate.textContent);
        }
        return candidate;
      }
      
      // Wait for DOM to be ready, then find price element
      function waitForPrice() {
        var target = findNode();
        if (!target) {
          console.log('No price element found yet for', '${symbol}', '- retrying...');
          setTimeout(waitForPrice, 100);
          return;
        }
        
        function getText(el) {
          var t = (el && el.textContent) ? String(el.textContent).trim() : '';
          console.log('Raw text for ${symbol}:', t);
          // Improved regex to match prices with commas and decimals
          var regex = new RegExp('(?:\\\\d{1,3}(?:,\\\\d{3})*(?:\\\\.\\\\d+)?|\\\\d+(?:\\\\.\\\\d+)?)');
          var m = t.match(regex);
          var price = m ? m[0] : '';
          if (!price && /\d/.test(t)) {
            var cleaned = t.replace(/[^0-9.,]/g, '');
            if (cleaned) price = cleaned;
          }
          console.log('Extracted price for ${symbol}:', price);
          return price;
        }
        var last = getText(target);
        console.log('Initial price found:', last, 'for', '${symbol}');
        if (last) {
          console.log('Calling notifyPrice with:', last);
          try { if (window.notifyPrice) window.notifyPrice(last); } catch {}
          console.log('PP_PRICE ' + last);
        } else {
          console.log('Empty initial price for ${symbol}, will wait for updates');
        }
        
        var mo = new MutationObserver(function(mutations) {
          // Only process mutations that might affect text content
          var shouldCheck = false;
          for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            if (mutation.type === 'characterData' || 
                mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
              shouldCheck = true;
              break;
            }
          }
          
          if (!shouldCheck) return;
          
          // If node got detached or became empty for long, re-find and rebind
          if (!document.contains(target) || !target.textContent) {
            var newTarget = findNode();
            if (newTarget && newTarget !== target) {
              target = newTarget;
              last = getText(target) || last;
              console.log('Rebound observer to new target for', '${symbol}', 'last=', last);
              try { mo.disconnect(); } catch (e) {}
              try { mo.observe(target, { childList: true, subtree: true, characterData: true }); } catch (e) {}
            }
          }
          var cur = getText(target);
          if (cur && cur !== last) {
            console.log('Price changed:', last, '->', cur, 'for', '${symbol}');
            last = cur;
            try { if (window.notifyPrice) window.notifyPrice(cur); } catch {}
            console.log('PP_PRICE ' + cur);
          }
        });
        try { mo.observe(target, { childList: true, subtree: true, characterData: true }); } catch (e) {}
        console.log('MutationObserver set up for', '${symbol}');
        
        // Pure push-based architecture: rely only on MutationObserver for real-time updates
      }
      
      // Start waiting for price element
      waitForPrice();
    })();` });
    
    // Navigate last so the init script hooks at document-start
    // eslint-disable-next-line no-console
    console.log('opening ticker page', symbol);
    await page.goto(url, { waitUntil: 'networkidle' });
    
    // Wait a bit more for the page to fully load and check if we can find price elements
    await page.waitForTimeout(500);
    try {
      await page.waitForFunction(() => {
        const el = document.querySelector(
          '.tv-symbol-price-quote__value.js-symbol-last, .tv-symbol-price-quote__value, [data-field="last"], [data-name="price"], .last-price-value, .js-symbol-last'
        );
        if (!el) return false;
        const t = (el.textContent || '').trim();
        return /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/.test(t);
      }, { timeout: 15000 });
    } catch {}
    
    // Debug: Check what's in the DOM
    const pageTitle = await page.title();
    // eslint-disable-next-line no-console
    console.log('Page title:', pageTitle);
    
    // Try to find price elements manually to debug
    const priceSelectors = [
      '.tv-symbol-price-quote__value.js-symbol-last',
      '.tv-symbol-price-quote__value',
      '[data-field="last"]',
      '[data-name="price"]',
      '.last-price-value',
      '.js-symbol-last'
    ];
    
    for (const selector of priceSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          // eslint-disable-next-line no-console
          console.log('Found element with selector:', selector, 'text:', text);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log('Error checking selector:', selector, e);
      }
    }

    this.symbolToPage.set(symbol, page);
    this.lastUsed.set(symbol, Date.now());

    // Pure push-based architecture: rely on MutationObserver for all updates

    // Pure push-based: no polling timers, rely on MutationObserver for all updates
  }

  private enqueueOpen(symbol: string, requestedPriority: number): void {
    // De-dupe if already open
    if (this.symbolToPage.has(symbol)) return;
    const priority = Math.min(requestedPriority, this.computePriority(symbol));
    const existing = this.queuedJobs.get(symbol);
    if (existing) {
      if (priority < existing.priority) {
        existing.priority = priority;
        // Move to higher-priority bucket
        for (const b of this.queueByPriority) {
          const i = b.indexOf(symbol);
          if (i >= 0) b.splice(i, 1);
        }
        this.queueByPriority[priority].push(symbol);
      }
      return;
    }
    if (this.totalQueued() >= this.maxQueue) {
      // eslint-disable-next-line no-console
      console.warn('Playwright: queue full, dropping enqueue for', symbol);
      return;
    }
    this.queuedJobs.set(symbol, { symbol, priority, enqueuedAt: Date.now() });
    this.queueByPriority[priority].push(symbol);
    // eslint-disable-next-line no-console
    console.log('Playwright: enqueued', symbol, 'priority', priority, 'qdepth', this.totalQueued());
    this.drainQueue();
  }

  private computePriority(symbol: string): number {
    const subs = this.symbolToSubs.get(symbol);
    if (subs && subs.size > 0) return 0; // hot
    const warm = this.warmUntil.get(symbol) ?? 0;
    if (warm > Date.now()) return 1; // warm
    return 2; // cold
  }

  private totalQueued(): number {
    let n = 0;
    for (const b of this.queueByPriority) n += b.length;
    return n;
  }

  private nextJobSymbol(): string | undefined {
    for (let p = 0; p < this.queueByPriority.length; p++) {
      const bucket = this.queueByPriority[p];
      if (bucket.length) return bucket.shift();
    }
    return undefined;
  }

  private async drainQueue(): Promise<void> {
    while (this.inFlightOpens < this.openConcurrency) {
      const sym = this.nextJobSymbol();
      if (!sym) return;
      const job = this.queuedJobs.get(sym);
      if (!job) continue;
      // Cancellation: if no subscribers and not warm anymore, drop it
      const pri = this.computePriority(sym);
      if (pri > job.priority && pri === 2) {
        this.queuedJobs.delete(sym);
        // eslint-disable-next-line no-console
        console.log('Playwright: canceled (no subs)', sym);
        continue;
      }
      
      // Timeout: if job has been queued for too long, retry with higher priority
      const queuedFor = Date.now() - job.enqueuedAt;
      if (queuedFor > 10000) { // 10 seconds timeout
        this.queuedJobs.delete(sym);
        // eslint-disable-next-line no-console
        console.warn('Playwright: job timeout, retrying', sym, 'queued for', queuedFor, 'ms');
        this.enqueueOpen(sym, 0); // Retry with highest priority
        continue;
      }
      
      this.queuedJobs.delete(sym);
      this.inFlightOpens += 1;
      // eslint-disable-next-line no-console
      console.log('Playwright: started open', sym, 'inflight', this.inFlightOpens);
      this.openPage(sym)
        .then(() => {
          // eslint-disable-next-line no-console
          console.log('Playwright: completed open', sym);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('Playwright: failed open', sym, String(err));
          if ((this.symbolToSubs.get(sym)?.size ?? 0) > 0) this.enqueueOpen(sym, 1);
        })
        .finally(() => {
          this.inFlightOpens = Math.max(0, this.inFlightOpens - 1);
          this.drainQueue();
        });
    }
  }

  private async closePage(symbol: string): Promise<void> {
    const page = this.symbolToPage.get(symbol);
    if (page) {
      await page.close().catch(() => {});
      // eslint-disable-next-line no-console
      console.log('closing idle ticker', symbol);
    }
    this.symbolToPage.delete(symbol);
    this.symbolToIdleTimer.delete(symbol);
    this.lastUsed.delete(symbol);
  }

  getLastPrice(symbol: string): string | undefined {
    const upper = symbol.toUpperCase();
    const price = this.symbolToLast.get(upper);
    console.log('getLastPrice', { symbol: upper, price, allPrices: Array.from(this.symbolToLast.entries()) });
    return price;
  }

  getQueueDepth(): number {
    return this.totalQueued();
  }

  /** Stats helpers for observability (/metrics). */
  getStats(): {
    openPages: number;
    subscribers: number;
    idleTimers: number;
    lastPrices: number;
    symbols: string[];
  } {
    let subscribers = 0;
    for (const s of this.symbolToSubs.values()) subscribers += s.size;
    return {
      openPages: this.symbolToPage.size,
      subscribers,
      idleTimers: this.symbolToIdleTimer.size,
      lastPrices: this.symbolToLast.size,
      symbols: Array.from(this.symbolToPage.keys()),
    };
  }
}

