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

export interface OrderBookAd {
  id: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  minAmount: number;
  maxAmount: number;
  nickName: string;
  userId: string;
  recentOrderNum: number;
  recentExecuteRate: number;
  authTag: string[];
  authStatus: number;
  isOnline: boolean;
  userType: string;
}
