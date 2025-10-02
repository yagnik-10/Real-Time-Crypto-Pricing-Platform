import { createConnectTransport } from '@connectrpc/connect-web';
import { createPromiseClient } from '@connectrpc/connect';
import { PriceService } from '../gen/price/v1/price_connect';

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

export const transport = createConnectTransport({ baseUrl });
export const client = createPromiseClient(PriceService, transport);

export function getClientId(): string {
  if (typeof window === 'undefined') return 'server';
  const key = 'client_id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const v = crypto.randomUUID();
  sessionStorage.setItem(key, v);
  return v;
}


