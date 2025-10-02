import http from 'http';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import type { ConnectRouter } from '@connectrpc/connect';
import { PriceService } from './gen/price/v1/price_connect.js';
import { AddTickerResponse, RemoveTickerResponse } from './gen/price/v1/price_pb.js';
import { addServiceImpl, getPoolStats } from './rpc/priceService.impl.js';

const PORT = 8080;

function routes(router: ConnectRouter) {
  addRoutes(router);
}

const handler = connectNodeAdapter({
  routes: (router: ConnectRouter) => {
    router.service(PriceService, addServiceImpl());
    return router;
  },
});

const server = http.createServer((req, res) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms, Connect-Accept-Encoding, Connect-Content-Encoding');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.end();
    return;
  }
  // Health check
  if (req.url === '/healthz') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
    return;
  }
  // Minimal metrics (text/plain Prometheus-style)
  if (req.url === '/metrics') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    const up = 1;
    const stats = getPoolStats?.();
    const lines = [
      `app_up ${up}`,
      stats ? `playwright_open_pages ${stats.openPages}` : '',
      stats ? `playwright_subscribers_total ${stats.subscribers}` : '',
      stats ? `playwright_last_prices_total ${stats.lastPrices}` : '',
    ].filter(Boolean);
    res.end(lines.join('\n') + '\n');
    return;
  }
  // Add ACAO for actual responses
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  return handler(req, res);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`server listening on http://localhost:${PORT}`);
});


