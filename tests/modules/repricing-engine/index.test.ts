import { describe, it, expect, vi } from 'vitest';
import { RepricingEngine } from '../../../src/modules/repricing-engine/index.js';
import type { OrderBookAd } from '../../../src/bybit/types.js';
import type { RepricingConfig } from '../../../src/modules/repricing-engine/types.js';
import { DEFAULT_FILTERS } from '../../../src/modules/repricing-engine/types.js';

const makeSellAd = (price: number, nickName = 'seller', overrides: Partial<OrderBookAd> = {}): OrderBookAd => ({
  id: `sell-${price}`,
  side: 'sell',
  price,
  quantity: 500,
  minAmount: 10,
  maxAmount: 5000,
  nickName,
  userId: `u-${nickName}`,
  recentOrderNum: 50,
  recentExecuteRate: 95,
  authTag: ['GA'],
  authStatus: 2,
  isOnline: true,
  userType: 'PERSONAL',
  ...overrides,
});

const makeBuyAd = (price: number, nickName = 'buyer', overrides: Partial<OrderBookAd> = {}): OrderBookAd => ({
  id: `buy-${price}`,
  side: 'buy',
  price,
  quantity: 500,
  minAmount: 10,
  maxAmount: 5000,
  nickName,
  userId: `u-${nickName}`,
  recentOrderNum: 50,
  recentExecuteRate: 95,
  authTag: ['GA'],
  authStatus: 2,
  isOnline: true,
  userType: 'PERSONAL',
  ...overrides,
});

const config: RepricingConfig = {
  mode: 'conservative',
  targetPosition: 3,
  antiOscillationThreshold: 0.003,
  minSpread: 0.010,
  maxSpread: 0.050,
  filters: DEFAULT_FILTERS,
  selfUserId: 'self-id',
};

describe('RepricingEngine', () => {
  it('returns reprice with valid order book', async () => {
    const sellAds = [
      makeSellAd(9.343),
      makeSellAd(9.344),
      makeSellAd(9.345),
      makeSellAd(9.346),
    ];
    const buyAds = [
      makeBuyAd(9.330),
      makeBuyAd(9.328),
      makeBuyAd(9.325),
    ];

    const fetchOrderBook = vi.fn().mockResolvedValue({ sell: sellAds, buy: buyAds });
    const engine = new RepricingEngine(config, fetchOrderBook);

    const result = await engine.reprice({ buy: null, sell: null });

    expect(result.action).toBe('reprice');
    expect(result.buyPrice).toBeGreaterThan(0);
    expect(result.sellPrice).toBeGreaterThan(result.buyPrice);
    expect(result.spread).toBeGreaterThanOrEqual(0.010);
  });

  it('returns hold when fetch fails', async () => {
    const fetchOrderBook = vi.fn().mockRejectedValue(new Error('network'));
    const engine = new RepricingEngine(config, fetchOrderBook);

    const result = await engine.reprice({ buy: null, sell: null });

    expect(result.action).toBe('hold');
    expect(result.reason.toLowerCase()).toContain('fetch');
  });

  it('returns hold when filtered book is empty', async () => {
    // recentOrderNum=1 fails filter (minOrderCount=10)
    const sellAds = [makeSellAd(9.343, 'seller', { recentOrderNum: 1 })];
    const buyAds = [makeBuyAd(9.335, 'buyer', { recentOrderNum: 1 })];

    const fetchOrderBook = vi.fn().mockResolvedValue({ sell: sellAds, buy: buyAds });
    const engine = new RepricingEngine(config, fetchOrderBook);

    const result = await engine.reprice({ buy: null, sell: null });

    expect(result.action).toBe('hold');
  });

  it('returns pause when spread < minSpread', async () => {
    // sell at 9.343, buy at 9.343 — after optimal price calc and safety bounds,
    // set up scenario where spread is forced to 0 before safety bounds would widen it
    // We need to trigger the spread check (phase 4) which is checkSpread on the market
    // To get pause from spread check: bestAsk - bestBid < minSpread (0.010)
    // bestAsk = 9.343 (sell), bestBid = 9.343 (buy) → spread = 0 < 0.010 → pause
    const sellAds = [
      makeSellAd(9.343),
      makeSellAd(9.344),
      makeSellAd(9.345),
    ];
    const buyAds = [
      makeBuyAd(9.343),
      makeBuyAd(9.342),
      makeBuyAd(9.341),
    ];

    const fetchOrderBook = vi.fn().mockResolvedValue({ sell: sellAds, buy: buyAds });
    const engine = new RepricingEngine(config, fetchOrderBook);

    const result = await engine.reprice({ buy: null, sell: null });

    expect(result.action).toBe('pause');
    expect(result.reason.toLowerCase()).toContain('spread');
  });

  it('returns hold when anti-oscillation triggers', async () => {
    const sellAds = [
      makeSellAd(9.343),
      makeSellAd(9.344),
      makeSellAd(9.345),
      makeSellAd(9.346),
    ];
    const buyAds = [
      makeBuyAd(9.330),
      makeBuyAd(9.328),
      makeBuyAd(9.325),
    ];

    const fetchOrderBook = vi.fn().mockResolvedValue({ sell: sellAds, buy: buyAds });
    const engine = new RepricingEngine(config, fetchOrderBook);

    // First call — no current prices, should reprice
    const first = await engine.reprice({ buy: null, sell: null });
    expect(first.action).toBe('reprice');

    // Second call with same prices — changes are below threshold → hold
    const second = await engine.reprice({ buy: first.buyPrice, sell: first.sellPrice });
    expect(second.action).toBe('hold');
  });

  it('detects aggressive competitor', async () => {
    // kamikaze at 9.320 is far below normal ads at 9.343–9.345
    // gaps from #2 onward: [0.001, 0.001, 0.001] median = 0.001
    // gap #1→#2: 9.343 - 9.320 = 0.023 > 2 * 0.001 = 0.002 → excluded
    // After excluding kamikaze, sell min = 9.343, buy max = 9.300 → spread = 0.043 >= 0.010
    const sellAds = [
      makeSellAd(9.343),
      makeSellAd(9.344),
      makeSellAd(9.345),
      makeSellAd(9.320, 'kamikaze'),
    ];
    const buyAds = [
      makeBuyAd(9.300),
      makeBuyAd(9.298),
      makeBuyAd(9.295),
    ];

    const fetchOrderBook = vi.fn().mockResolvedValue({ sell: sellAds, buy: buyAds });
    const engine = new RepricingEngine(config, fetchOrderBook);

    const result = await engine.reprice({ buy: null, sell: null });

    expect(result.excludedAggressive.length).toBeGreaterThan(0);
    expect(result.excludedAggressive.some((e) => e.nickName === 'kamikaze')).toBe(true);
  });

  it('tracks position', async () => {
    const sellAds = [
      makeSellAd(9.343),
      makeSellAd(9.344),
      makeSellAd(9.345),
      makeSellAd(9.346),
    ];
    const buyAds = [
      makeBuyAd(9.330),
      makeBuyAd(9.328),
      makeBuyAd(9.325),
    ];

    const fetchOrderBook = vi.fn().mockResolvedValue({ sell: sellAds, buy: buyAds });
    const engine = new RepricingEngine(config, fetchOrderBook);

    const result = await engine.reprice({ buy: null, sell: null });

    expect(result.position.sell).toBeGreaterThan(0);
    expect(result.position.buy).toBeGreaterThan(0);
  });
});
