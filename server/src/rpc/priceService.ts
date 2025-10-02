import { ConnectRouter } from '@connectrpc/connect';
import { AddTickerResponse, RemoveTickerResponse, PricePoint } from '../../src/gen/price/v1/price_pb.js';
import { PriceService } from '../../src/gen/price/v1/price_connect.js';

export function addRoutes(router: ConnectRouter) {
  router.service(PriceService, {
    async addTicker(): Promise<AddTickerResponse> {
      return { success: true, errorMessage: '', initialPrice: undefined } as unknown as AddTickerResponse;
    },
    async removeTicker(): Promise<RemoveTickerResponse> {
      return { success: true, errorMessage: '' } as unknown as RemoveTickerResponse;
    },
    async *streamPrices(): AsyncIterable<PricePoint> {
      // stub: no data yet
      return;
    },
  });
}


