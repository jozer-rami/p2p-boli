import { eventLog } from './db/schema.js';
import { createModuleLogger } from './utils/logger.js';
import type { DB } from './db/index.js';

const log = createModuleLogger('event-bus');

export type Side = 'buy' | 'sell';

export interface PlatformPrices {
  platform: string;
  ask: number;
  totalAsk: number;
  bid: number;
  totalBid: number;
  time: number;
}

export interface EventMap {
  'price:updated': { prices: PlatformPrices[]; timestamp: number };
  'price:spread-alert': { platform: string; spread: number; direction: Side };
  'price:volatility-alert': {
    currentPrice: number;
    previousPrice: number;
    changePercent: number;
    windowMinutes: number;
  };
  'price:stale': { lastUpdate: number; staleDurationSeconds: number };

  'ad:created': { adId: string; side: Side; price: number; bankAccount: string };
  'ad:repriced': { adId: string; side: Side; oldPrice: number; newPrice: number };
  'ad:paused': { side: Side; reason: string };
  'ad:resumed': { side: Side };
  'ad:spread-inversion': { buyPrice: number; sellPrice: number };

  'order:new': { orderId: string; side: Side; amount: number; price: number; counterparty: string };
  'order:payment-claimed': { orderId: string; amount: number; bankAccount: string };
  'order:released': { orderId: string; amount: number; profit: number };
  'order:cancelled': { orderId: string; reason: string };
  'order:disputed': { orderId: string; reason: string };

  'bank:low-balance': { accountId: number; balance: number; threshold: number };
  'bank:daily-limit': { accountId: number; dailyVolume: number; limit: number };
  'bank:balance-updated': { accountId: number; newBalance: number };

  'emergency:triggered': {
    reason: string;
    trigger: 'volatility' | 'spread_inversion' | 'stale_data' | 'manual';
    marketState: { ask: number; bid: number };
    exposure: { usdt: number; bob: number };
  };
  'emergency:resolved': { resumedBy: string };

  'telegram:release': { orderId: string };
  'telegram:dispute': { orderId: string };
  'telegram:emergency': Record<string, never>;
  'telegram:command': { command: string; args: string[] };
}

type Handler<T> = (payload: T) => void | Promise<void>;

export class EventBus {
  private readonly db: DB;
  private readonly listeners: Map<keyof EventMap, Set<Handler<unknown>>>;

  constructor(db: DB) {
    this.db = db;
    this.listeners = new Map();
  }

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as Handler<unknown>);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.listeners.get(event)?.delete(handler as Handler<unknown>);
  }

  async emit<K extends keyof EventMap>(event: K, payload: EventMap[K], module: string): Promise<void> {
    // Persist to DB
    try {
      await this.db.insert(eventLog).values({
        eventType: event as string,
        payload: JSON.stringify(payload),
        module,
      });
    } catch (err) {
      log.error({ err, event, module }, 'Failed to persist event to event_log');
    }

    // Notify listeners
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await (handler as Handler<EventMap[K]>)(payload);
        } catch (err) {
          log.error({ err, event, module }, 'Event handler threw an error');
        }
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
