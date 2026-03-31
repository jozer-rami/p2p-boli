import { describe, it, expect } from 'vitest';
import {
  calculatePosition,
  checkSpread,
  assessVolume,
  detectAggressive,
  calculateOptimalPrice,
  applySafetyBounds,
  checkAntiOscillation,
} from '../../../src/modules/repricing-engine/phases.js';
import type { OrderBookAd } from '../../../src/bybit/types.js';

const makeAd = (price: number, quantity = 500, nickName = 'trader'): OrderBookAd => ({
  id: '1',
  side: 'sell',
  price,
  quantity,
  minAmount: 10,
  maxAmount: 5000,
  nickName,
  userId: 'u1',
  recentOrderNum: 50,
  recentExecuteRate: 95,
  authTag: ['GA'],
  authStatus: 2,
  isOnline: true,
  userType: 'PERSONAL',
});

// ---------------------------------------------------------------------------
// calculatePosition
// ---------------------------------------------------------------------------
describe('calculatePosition', () => {
  it('returns correct sell position (ascending sort)', () => {
    const ads = [makeAd(9.5), makeAd(9.3), makeAd(9.7)];
    // sorted: 9.3, 9.5, 9.7 — myPrice 9.5 ranks at position 2
    expect(calculatePosition(ads, 9.5, 'sell')).toBe(2);
  });

  it('returns position 1 when myPrice is best (cheapest sell)', () => {
    const ads = [makeAd(9.5), makeAd(9.7), makeAd(9.9)];
    // sorted: 9.5, 9.7, 9.9 — myPrice 9.0 ranks at position 1
    expect(calculatePosition(ads, 9.0, 'sell')).toBe(1);
  });

  it('returns correct buy position (descending sort)', () => {
    const ads = [makeAd(9.3), makeAd(9.5), makeAd(9.7)];
    // sorted desc: 9.7, 9.5, 9.3 — myPrice 9.5 ranks at position 2
    expect(calculatePosition(ads, 9.5, 'buy')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// checkSpread
// ---------------------------------------------------------------------------
describe('checkSpread', () => {
  it('returns bestAsk - bestBid for non-empty books', () => {
    const sellAds = [makeAd(9.5), makeAd(9.7)];
    const buyAds = [makeAd(9.2), makeAd(9.0)];
    // bestAsk = 9.5, bestBid = 9.2 → spread = 0.3
    expect(checkSpread(sellAds, buyAds)).toBeCloseTo(0.3);
  });

  it('returns null when either side is empty', () => {
    expect(checkSpread([], [makeAd(9.2)])).toBeNull();
    expect(checkSpread([makeAd(9.5)], [])).toBeNull();
    expect(checkSpread([], [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// assessVolume
// ---------------------------------------------------------------------------
describe('assessVolume', () => {
  it('skips top ad if quantity * price < 50 USDT threshold', () => {
    // top sell ad: price=9.4, quantity=5 → 5*9.4=47 USDT < 50 → skip
    const ads = [makeAd(9.4, 5), makeAd(9.6, 500)];
    const result = assessVolume(ads, 'sell');
    expect(result.skippedThinTop).toBe(true);
    expect(result.effectiveTopPrice).toBe(9.6);
  });

  it('keeps top ad if quantity * price >= 50 USDT threshold', () => {
    // top sell ad: price=9.4, quantity=500 → 500*9.4=4700 USDT ≥ 50 → keep
    const ads = [makeAd(9.4, 500), makeAd(9.6, 500)];
    const result = assessVolume(ads, 'sell');
    expect(result.skippedThinTop).toBe(false);
    expect(result.effectiveTopPrice).toBe(9.4);
  });
});

// ---------------------------------------------------------------------------
// detectAggressive
// ---------------------------------------------------------------------------
describe('detectAggressive', () => {
  it('detects outlier aggressive price gap', () => {
    // sorted sell: 9.0, 9.1, 9.2, 9.3
    // gaps: [0.1, 0.1, 0.1] — median = 0.1
    // gap between #1 (9.0) and #2 (9.1) = 0.1 — NOT > 2× median
    // Try a real outlier: 8.0, 9.0, 9.1, 9.2
    // gaps from #2 onward: [0.1, 0.1] — median = 0.1
    // gap #1→#2 = 1.0 > 2 × 0.1 = 0.2 → excluded
    const ads = [makeAd(9.0), makeAd(9.1), makeAd(8.0), makeAd(9.2)];
    const result = detectAggressive(ads, 'sell');
    expect(result.excluded).not.toBeNull();
    expect(result.excluded?.price).toBe(8.0);
    expect(result.remaining).toHaveLength(3);
  });

  it('returns null excluded when no outlier gap detected', () => {
    const ads = [makeAd(9.0), makeAd(9.1), makeAd(9.2), makeAd(9.3)];
    const result = detectAggressive(ads, 'sell');
    expect(result.excluded).toBeNull();
    expect(result.remaining).toHaveLength(4);
  });

  it('returns null excluded when fewer than 3 ads', () => {
    const ads = [makeAd(9.0), makeAd(9.5)];
    const result = detectAggressive(ads, 'sell');
    expect(result.excluded).toBeNull();
    expect(result.remaining).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// calculateOptimalPrice
// ---------------------------------------------------------------------------
describe('calculateOptimalPrice', () => {
  it('conservative sell: undercuts position 3 by 0.001', () => {
    // targetPosition=3, sorted sell: 9.0, 9.1, 9.2, 9.3
    // position 3 price = 9.2 → undercut → 9.2 - 0.001 = 9.199
    const ads = [makeAd(9.0), makeAd(9.1), makeAd(9.2), makeAd(9.3)];
    expect(calculateOptimalPrice(ads, 'sell', 3)).toBe(9.199);
  });

  it('aggressive sell: undercuts position 1 by 0.001', () => {
    // targetPosition=1, sorted sell: 9.0, 9.1, 9.2
    // position 1 price = 9.0 → undercut → 9.0 - 0.001 = 8.999
    const ads = [makeAd(9.0), makeAd(9.1), makeAd(9.2)];
    expect(calculateOptimalPrice(ads, 'sell', 1)).toBe(8.999);
  });

  it('buy: outbids target position by 0.001', () => {
    // targetPosition=3, sorted buy desc: 9.3, 9.2, 9.1, 9.0
    // position 3 price = 9.1 → outbid → 9.1 + 0.001 = 9.101
    const ads = [makeAd(9.0), makeAd(9.1), makeAd(9.2), makeAd(9.3)];
    expect(calculateOptimalPrice(ads, 'buy', 3)).toBe(9.101);
  });

  it('fallback: fewer competitors than target, match position 1', () => {
    // targetPosition=3, only 2 sell ads: 9.0, 9.1
    // fewer than target → match position 1 = 9.0 → 9.0 - 0.001 = 8.999
    const ads = [makeAd(9.0), makeAd(9.1)];
    expect(calculateOptimalPrice(ads, 'sell', 3)).toBe(8.999);
  });
});

// ---------------------------------------------------------------------------
// applySafetyBounds
// ---------------------------------------------------------------------------
describe('applySafetyBounds', () => {
  it('returns prices unchanged when spread is within bounds', () => {
    // spread = 9.5 - 9.2 = 0.3, bounds [0.1, 0.5]
    const result = applySafetyBounds(9.2, 9.5, 0.1, 0.5);
    expect(result.buyPrice).toBe(9.2);
    expect(result.sellPrice).toBe(9.5);
  });

  it('widens spread when it is below minSpread', () => {
    // spread = 9.5 - 9.48 = 0.02, minSpread = 0.1
    // mid = (9.5 + 9.48) / 2 = 9.49
    // buyPrice = 9.49 - 0.05 = 9.44, sellPrice = 9.49 + 0.05 = 9.54
    const result = applySafetyBounds(9.48, 9.5, 0.1, 0.5);
    expect(result.sellPrice - result.buyPrice).toBeCloseTo(0.1);
  });

  it('rounds prices to 3 decimals', () => {
    // Prices that when adjusted could produce many decimal places
    const result = applySafetyBounds(9.2, 9.5, 0.1, 0.5);
    const buyDecimals = (result.buyPrice.toString().split('.')[1] ?? '').length;
    const sellDecimals = (result.sellPrice.toString().split('.')[1] ?? '').length;
    expect(buyDecimals).toBeLessThanOrEqual(3);
    expect(sellDecimals).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// checkAntiOscillation
// ---------------------------------------------------------------------------
describe('checkAntiOscillation', () => {
  it('returns true (hold) when both changes are below threshold', () => {
    // change in buy: |9.201 - 9.2| = 0.001 < 0.003
    // change in sell: |9.501 - 9.5| = 0.001 < 0.003
    expect(checkAntiOscillation(9.201, 9.501, 9.2, 9.5, 0.003)).toBe(true);
  });

  it('returns false (reprice) when a change exceeds threshold', () => {
    // change in buy: |9.21 - 9.2| = 0.01 > 0.003
    expect(checkAntiOscillation(9.21, 9.5, 9.2, 9.5, 0.003)).toBe(false);
  });

  it('returns false (reprice) on first run when currentBuy/currentSell are null', () => {
    expect(checkAntiOscillation(9.2, 9.5, null, null, 0.003)).toBe(false);
  });
});
