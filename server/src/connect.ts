import type { ConnectRouter } from '@connectrpc/connect';
import { PriceService } from './gen/price/v1/price_connect.js';
import { addServiceImpl } from './rpc/priceService.impl.js';

export default function routes(router: ConnectRouter) {
  router.service(PriceService, addServiceImpl());
  return router;
}


