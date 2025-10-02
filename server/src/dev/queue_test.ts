import { PlaywrightPool } from '../playwright/PlaywrightPool.js';

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const pool = new PlaywrightPool(5000, 20);
  // Prevent real browser launch
  (pool as any).ensure = async () => {};

  let active = 0;
  let maxActive = 0;
  let opened = 0;

  // Stub openPage to simulate work
  (pool as any).openPage = async (symbol: string) => {
    active += 1;
    if (active > maxActive) maxActive = active;
    await sleep(200);
    (pool as any).symbolToPage.set(symbol, true);
    opened += 1;
    active -= 1;
  };

  const symbols = [
    'BTCUSD','ETHUSD','BNBUSD','ADAUSD','XRPUSD','DOGEUSD','LTCUSD','SOLUSD',
    'DOTUSD','AVAXUSD','MATICUSD','LINKUSD','UNIUSD','TRXUSD','ATOMUSD'
  ];

  await Promise.all(symbols.map((s) => (pool as any).subscribe(s, () => {})));

  const t0 = Date.now();
  while (((pool as any).inFlightOpens ?? 0) > 0 || ((pool as any).getQueueDepth?.() ?? 0) > 0) {
    if (Date.now() - t0 > 10000) break;
    await sleep(25);
  }

  const result = { maxActive, opened, inflight: (pool as any).inFlightOpens ?? 0, qd: (pool as any).getQueueDepth?.() ?? 0, pass: maxActive <= 2 };
  console.log(JSON.stringify(result));
  if (!result.pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });


