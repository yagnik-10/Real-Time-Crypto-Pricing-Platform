import { PlaywrightPool } from '../playwright/PlaywrightPool.js';

async function main() {
  const pool = new PlaywrightPool(30000);
  await pool.subscribe('BTCUSD', (d) => console.log('price update', d));
  // keep process alive for observation
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


