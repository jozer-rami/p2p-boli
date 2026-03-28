import type { Side } from '../event-bus.js';

export interface BybitAdParams {
  side: Side;
  price: number;
  amount: number;
  currencyId: string;       // 'USDT'
  fiatCurrencyId: string;   // 'BOB'
  paymentMethodIds: string[];
  remark?: string;
}

export interface BybitAd {
  id: string;
  side: Side;
  price: number;
  amount: number;
  status: string;
}

export interface BybitOrder {
  id: string;
  side: Side;
  amount: number;
  price: number;
  totalBob: number;
  status: string;
  counterpartyId: string;
  counterpartyName: string;
  createdAt: number;
}

export interface BybitBalance {
  coin: string;
  available: number;
  frozen: number;
}
