import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../../../src/event-bus.js';
import { createTestDB } from '../../../src/db/index.js';
import { PriceMonitor } from '../../../src/modules/price-monitor/index.js';
import type { CriptoYaClient } from '../../../src/modules/price-monitor/criptoya.js';
import type { DB } from '../../../src/db/index.js';

type MockClient = {
  [K in keyof CriptoYaClient]: ReturnType<typeof vi.fn>;
};

let db: DB;
let close: () => void;
let bus: EventBus;
let mockClient: MockClient;

beforeEach(() => {
  ({ db, close } = createTestDB());
  bus = new EventBus(db);
  mockClient = {
    getUsdtBobPrices: vi.fn(),
    getFees: vi.fn(),
  };
});

afterEach(() => {
  bus.removeAllListeners();
  close();
  vi.restoreAllMocks();
});

describe('PriceMonitor', () => {
  it('emits price:updated with fetched prices', async () => {
    const prices = [
      { platform: 'binance', ask: 9.40, totalAsk: 1000, bid: 9.35, totalBid: 2000, time: Date.now() },
      { platform: 'bybit', ask: 9.42, totalAsk: 500, bid: 9.36, totalBid: 800, time: Date.now() },
    ];

    mockClient.getUsdtBobPrices.mockResolvedValue(prices);

    const received: { prices: typeof prices; timestamp: number }[] = [];
    bus.on('price:updated', (payload) => {
      received.push(payload as { prices: typeof prices; timestamp: number });
    });

    const monitor = new PriceMonitor(bus, db, mockClient as unknown as CriptoYaClient);
    await monitor.fetchOnce();

    expect(received).toHaveLength(1);
    expect(received[0].prices).toEqual(prices);
    expect(received[0].timestamp).toBeTypeOf('number');
  });

  it('emits price:volatility-alert when price change exceeds threshold', async () => {
    const pricesFirst = [
      { platform: 'bybit', ask: 9.40, totalAsk: 500, bid: 9.35, totalBid: 800, time: Date.now() },
    ];
    const pricesSecond = [
      { platform: 'bybit', ask: 9.65, totalAsk: 500, bid: 9.60, totalBid: 800, time: Date.now() },
    ];

    mockClient.getUsdtBobPrices
      .mockResolvedValueOnce(pricesFirst)
      .mockResolvedValueOnce(pricesSecond);

    const volatilityAlerts: unknown[] = [];
    bus.on('price:volatility-alert', (payload) => {
      volatilityAlerts.push(payload);
    });

    const monitor = new PriceMonitor(bus, db, mockClient as unknown as CriptoYaClient, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
    });

    // First fetch at bid 9.35
    await monitor.fetchOnce();
    // Second fetch at bid 9.60 — change = (9.60 - 9.35) / 9.35 * 100 ≈ 2.67% > 2%
    await monitor.fetchOnce();

    expect(volatilityAlerts).toHaveLength(1);
    const alert = volatilityAlerts[0] as {
      currentPrice: number;
      previousPrice: number;
      changePercent: number;
      windowMinutes: number;
    };
    expect(alert.currentPrice).toBe(9.60);
    expect(alert.previousPrice).toBe(9.35);
    expect(alert.changePercent).toBeGreaterThan(2);
    expect(alert.windowMinutes).toBe(5);
  });

  it('emits price:stale when data is old and fetch fails', async () => {
    mockClient.getUsdtBobPrices.mockRejectedValue(new Error('Network error'));

    const staleAlerts: unknown[] = [];
    bus.on('price:stale', (payload) => {
      staleAlerts.push(payload);
    });

    const monitor = new PriceMonitor(bus, db, mockClient as unknown as CriptoYaClient);

    // Set last update time to > 5 minutes ago
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    (monitor as unknown as { lastUpdateTime: number }).lastUpdateTime = sixMinutesAgo;

    await monitor.fetchOnce();

    expect(staleAlerts).toHaveLength(1);
    const alert = staleAlerts[0] as { lastUpdate: number; staleDurationSeconds: number };
    expect(alert.lastUpdate).toBe(sixMinutesAgo);
    expect(alert.staleDurationSeconds).toBeGreaterThan(300);
  });
});
