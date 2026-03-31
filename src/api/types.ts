// src/api/types.ts
import type { Side } from '../event-bus.js';

export interface StatusResponse {
  botState: string;
  pendingOrders: number;
  activeAds: Array<{ side: Side; price: number; amountUsdt: number }>;
  prices: { ask: number; bid: number };
  bankAccounts: Array<{ id: number; name: string; balanceBob: number; status: string }>;
  todayProfit: { tradesCount: number; profitBob: number; volumeUsdt: number };
  bybitUserId: string;
  dryRun: boolean;
}

export interface OrderResponse {
  id: string;
  side: Side;
  amount: number;
  price: number;
  totalBob: number;
  status: string;
  counterpartyId: string;
  counterpartyName: string;
  bankAccountId: number;
  bankAccountName: string;
  createdAt: number;
}

export interface ChatMessage {
  content: string;
  contentType: string;
  sendTime: number;
  fromUserId: string;
  roleType: string;
  nickName: string;
}

export interface TradeResponse {
  id: number;
  bybitOrderId: string;
  side: string;
  amountUsdt: number;
  priceBob: number;
  totalBob: number;
  spreadCaptured: number | null;
  counterpartyName: string | null;
  status: string;
  createdAt: string | null;
  completedAt: string | null;
}

export interface TradesWithSummary {
  trades: TradeResponse[];
  summary: { tradesCount: number; volumeUsdt: number; profitBob: number };
  previousPeriod: { tradesCount: number; volumeUsdt: number; profitBob: number };
}

export interface PricesResponse {
  prices: Array<{ platform: string; ask: number; bid: number; time: number }>;
}

export interface WsEvent {
  event: string;
  payload: unknown;
}
