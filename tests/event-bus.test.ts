import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { eventLog } from '../src/db/schema.js';
import { createTestDB } from '../src/db/index.js';
import { EventBus } from '../src/event-bus.js';
import type { DB } from '../src/db/index.js';

let db: DB;
let close: () => void;
let bus: EventBus;

beforeEach(() => {
  ({ db, close } = createTestDB());
  bus = new EventBus(db);
});

afterEach(() => {
  bus.removeAllListeners();
  close();
});

describe('EventBus', () => {
  it('emits and receives typed events', async () => {
    const received: { prices: unknown[]; timestamp: number }[] = [];

    bus.on('price:updated', (payload) => {
      received.push(payload);
    });

    const payload = {
      prices: [
        { platform: 'binance', ask: 37.5, totalAsk: 1000, bid: 37.2, totalBid: 2000, time: Date.now() },
      ],
      timestamp: Date.now(),
    };

    await bus.emit('price:updated', payload, 'PriceMonitor');

    expect(received).toHaveLength(1);
    expect(received[0].prices).toHaveLength(1);
    expect(received[0].timestamp).toBe(payload.timestamp);
  });

  it('persists events to event_log table', async () => {
    const payload = { orderId: 'ORD-001', side: 'buy' as const, amount: 100, price: 37.5, counterparty: 'user123' };

    await bus.emit('order:new', payload, 'OrderHandler');

    const rows = await db.select().from(eventLog).where(eq(eventLog.eventType, 'order:new'));
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('order:new');
    expect(rows[0].module).toBe('OrderHandler');

    const stored = JSON.parse(rows[0].payload ?? '{}');
    expect(stored.orderId).toBe('ORD-001');
    expect(stored.amount).toBe(100);
  });

  it('supports multiple listeners on the same event', async () => {
    const calls: string[] = [];

    bus.on('ad:paused', () => calls.push('listener-1'));
    bus.on('ad:paused', () => calls.push('listener-2'));
    bus.on('ad:paused', () => calls.push('listener-3'));

    await bus.emit('ad:paused', { side: 'buy', reason: 'spread-inversion' }, 'AdManager');

    expect(calls).toEqual(['listener-1', 'listener-2', 'listener-3']);
  });

  it('off removes a specific listener', async () => {
    const calls: string[] = [];

    const handler1 = () => calls.push('handler-1');
    const handler2 = () => calls.push('handler-2');

    bus.on('emergency:triggered', handler1);
    bus.on('emergency:triggered', handler2);

    bus.off('emergency:triggered', handler1);

    await bus.emit(
      'emergency:triggered',
      {
        reason: 'manual',
        trigger: 'manual',
        marketState: { ask: 38.0, bid: 37.0 },
        exposure: { usdt: 500, bob: 18000 },
      },
      'EmergencyManager',
    );

    expect(calls).toEqual(['handler-2']);
    expect(calls).not.toContain('handler-1');
  });
});
