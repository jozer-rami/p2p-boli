# Smart Repricing Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad pricing logic with a 12-phase repricing engine that filters competitors, detects aggressive pricing, tracks position, and supports conservative/aggressive modes with anti-oscillation.

**Architecture:** New `RepricingEngine` module takes raw Bybit order book data, runs it through 12 sequential phases (fetch → filter → position → spread → volume → aggression → price → bounds → profit → anti-oscillation → return → log), and returns a `RepricingResult` that tells AdManager what to do. REST API exposes config/status/orderbook for the dashboard.

**Tech Stack:** TypeScript, bybit-api (getP2POnlineAds), Express (REST routes), Drizzle ORM (config persistence), vitest

**Spec:** `docs/superpowers/specs/2026-03-29-smart-repricing-engine-design.md`

---

## File Map

### New files
- `src/modules/repricing-engine/types.ts` — OrderBookAd, OrderBookFilters, RepricingResult, PhaseTrace, RepricingMode
- `src/modules/repricing-engine/filters.ts` — applyFilters() pure function
- `src/modules/repricing-engine/phases.ts` — Individual phase functions (pure, testable)
- `src/modules/repricing-engine/index.ts` — RepricingEngine class (orchestrates phases, manages config)
- `src/api/routes/repricing.ts` — REST endpoints for config/status/orderbook
- `tests/modules/repricing-engine/filters.test.ts`
- `tests/modules/repricing-engine/phases.test.ts`
- `tests/modules/repricing-engine/index.test.ts`

### Modified files
- `src/bybit/types.ts` — Add OrderBookAd interface
- `src/bybit/client.ts` — New `getOnlineAdsEnriched()` method returning OrderBookAd[]
- `src/event-bus.ts` — Add `reprice:cycle` event
- `src/modules/ad-manager/index.ts` — Simplify tick() to delegate to engine
- `src/modules/telegram/index.ts` — Listen to `reprice:cycle` for notifications
- `src/index.ts` — Wire engine, register repricing API routes, seed config keys

### Kept (unchanged)
- `src/modules/ad-manager/pricing.ts` — Kept for simulator compatibility

---

## Task 1: Types + OrderBookAd

**Files:**
- Create: `src/modules/repricing-engine/types.ts`
- Modify: `src/bybit/types.ts`

- [ ] **Step 1: Add OrderBookAd to bybit types**

In `src/bybit/types.ts`, add after the existing `BybitBalance` interface:

```typescript
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
```

- [ ] **Step 2: Create repricing engine types**

Create `src/modules/repricing-engine/types.ts`:

```typescript
import type { Side } from '../../event-bus.js';

export type RepricingMode = 'conservative' | 'aggressive';

export interface OrderBookFilters {
  minOrderAmount: number;
  verifiedOnly: boolean;
  minCompletionRate: number;
  minOrderCount: number;
  merchantLevels: string[];
}

export interface RepricingConfig {
  mode: RepricingMode;
  targetPosition: number;
  antiOscillationThreshold: number;
  minSpread: number;
  maxSpread: number;
  filters: OrderBookFilters;
  selfUserId: string;
}

export interface RepricingResult {
  buyPrice: number;
  sellPrice: number;
  spread: number;
  position: { buy: number; sell: number };
  filteredCompetitors: { buy: number; sell: number };
  action: 'reprice' | 'hold' | 'pause';
  mode: RepricingMode;
  reason: string;
  phases: PhaseTrace[];
  excludedAggressive: Array<{ side: Side; nickName: string; price: number; gap: number }>;
}

export interface PhaseTrace {
  phase: number;
  name: string;
  result: string;
  durationMs: number;
}

export interface CurrentAdPrices {
  buy: number | null;
  sell: number | null;
}

export const DEFAULT_FILTERS: OrderBookFilters = {
  minOrderAmount: 100,
  verifiedOnly: true,
  minCompletionRate: 80,
  minOrderCount: 10,
  merchantLevels: ['GA', 'VA'],
};

export const MODE_PRESETS: Record<RepricingMode, { targetPosition: number; antiOscillationThreshold: number }> = {
  conservative: { targetPosition: 3, antiOscillationThreshold: 0.003 },
  aggressive: { targetPosition: 1, antiOscillationThreshold: 0.001 },
};
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/bybit/types.ts src/modules/repricing-engine/types.ts
git commit -m "feat(repricing): add OrderBookAd and repricing engine types"
```

---

## Task 2: Enriched Order Book Fetching

**Files:**
- Modify: `src/bybit/client.ts`

- [ ] **Step 1: Add getOnlineAdsEnriched method**

In `src/bybit/client.ts`, add a new method after the existing `getOnlineAds()`. Import `OrderBookAd` from `./types.js`.

```typescript
  /**
   * Get enriched online ads with full merchant data for repricing engine.
   */
  async getOnlineAdsEnriched(side: Side, currencyId: string, fiatId: string): Promise<OrderBookAd[]> {
    return withRetry(async () => {
      const res = await this.client.getP2POnlineAds({
        tokenId: currencyId,
        currencyId: fiatId,
        side: side === 'buy' ? '1' : '0',
      });

      if (getRetCode(res) !== 0) {
        throw new Error(`getOnlineAdsEnriched failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      const items = getResult(res)?.items ?? [];
      return items.map((ad: any) => ({
        id: String(ad.id),
        side: (ad.side === 1 || ad.side === '1') ? 'sell' : 'buy' as Side,
        price: parseFloat(ad.price),
        quantity: parseFloat(ad.lastQuantity || ad.quantity || '0'),
        minAmount: parseFloat(ad.minAmount || '0'),
        maxAmount: parseFloat(ad.maxAmount || '0'),
        nickName: ad.nickName || '',
        userId: String(ad.userId || ''),
        recentOrderNum: parseInt(ad.recentOrderNum || '0'),
        recentExecuteRate: parseInt(ad.recentExecuteRate || '0'),
        authTag: Array.isArray(ad.authTag) ? ad.authTag : [],
        authStatus: parseInt(ad.authStatus || '0'),
        isOnline: Boolean(ad.isOnline),
        userType: String(ad.userType || 'PERSONAL'),
      }));
    }, RETRY_OPTIONS);
  }
```

Add the import at the top of the file:

```typescript
import type { BybitAdParams, BybitAd, BybitOrder, BybitBalance, OrderBookAd } from './types.js';
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/bybit/client.ts
git commit -m "feat(repricing): add getOnlineAdsEnriched with full merchant data"
```

---

## Task 3: Order Book Filters

**Files:**
- Create: `src/modules/repricing-engine/filters.ts`
- Test: `tests/modules/repricing-engine/filters.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/modules/repricing-engine/filters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { applyFilters } from '../../../src/modules/repricing-engine/filters.js';
import type { OrderBookAd } from '../../../src/bybit/types.js';
import type { OrderBookFilters } from '../../../src/modules/repricing-engine/types.js';

const makeAd = (overrides: Partial<OrderBookAd> = {}): OrderBookAd => ({
  id: '1',
  side: 'sell',
  price: 9.345,
  quantity: 500,
  minAmount: 10,
  maxAmount: 5000,
  nickName: 'TestMerchant',
  userId: 'user-1',
  recentOrderNum: 50,
  recentExecuteRate: 95,
  authTag: ['GA'],
  authStatus: 2,
  isOnline: true,
  userType: 'PERSONAL',
  ...overrides,
});

const defaultFilters: OrderBookFilters = {
  minOrderAmount: 100,
  verifiedOnly: true,
  minCompletionRate: 80,
  minOrderCount: 10,
  merchantLevels: ['GA', 'VA'],
};

describe('applyFilters', () => {
  it('returns all ads when all pass filters', () => {
    const ads = [makeAd(), makeAd({ id: '2', price: 9.346 })];
    const result = applyFilters(ads, defaultFilters, 'self-id');
    expect(result).toHaveLength(2);
  });

  it('excludes own ads by userId', () => {
    const ads = [makeAd({ userId: 'self-id' }), makeAd({ id: '2' })];
    const result = applyFilters(ads, defaultFilters, 'self-id');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('excludes outlier prices', () => {
    const ads = [makeAd({ price: 6.85 }), makeAd({ id: '2', price: 9.345 })];
    const result = applyFilters(ads, defaultFilters, 'self-id');
    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(9.345);
  });

  it('filters by minOrderAmount (maxAmount < threshold)', () => {
    const ads = [makeAd({ maxAmount: 50 }), makeAd({ id: '2', maxAmount: 500 })];
    const result = applyFilters(ads, defaultFilters, 'self-id');
    expect(result).toHaveLength(1);
  });

  it('filters unverified when verifiedOnly is true', () => {
    const ads = [makeAd({ authStatus: 0 }), makeAd({ id: '2', authStatus: 2 })];
    const result = applyFilters(ads, defaultFilters, 'self-id');
    expect(result).toHaveLength(1);
  });

  it('does not filter unverified when verifiedOnly is false', () => {
    const ads = [makeAd({ authStatus: 0 }), makeAd({ id: '2', authStatus: 2 })];
    const result = applyFilters(ads, { ...defaultFilters, verifiedOnly: false }, 'self-id');
    expect(result).toHaveLength(2);
  });

  it('filters by minCompletionRate', () => {
    const ads = [makeAd({ recentExecuteRate: 60 }), makeAd({ id: '2', recentExecuteRate: 95 })];
    const result = applyFilters(ads, defaultFilters, 'self-id');
    expect(result).toHaveLength(1);
  });

  it('filters by minOrderCount', () => {
    const ads = [makeAd({ recentOrderNum: 3 }), makeAd({ id: '2', recentOrderNum: 50 })];
    const result = applyFilters(ads, defaultFilters, 'self-id');
    expect(result).toHaveLength(1);
  });

  it('filters by merchantLevels (authTag)', () => {
    const ads = [makeAd({ authTag: ['BLOCKED'] }), makeAd({ id: '2', authTag: ['VA'] })];
    const result = applyFilters(ads, defaultFilters, 'self-id');
    expect(result).toHaveLength(1);
  });

  it('allows ads with empty authTag when merchantLevels is empty', () => {
    const ads = [makeAd({ authTag: [] })];
    const result = applyFilters(ads, { ...defaultFilters, merchantLevels: [] }, 'self-id');
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/repricing-engine/filters.test.ts`
Expected: FAIL — Cannot find module.

- [ ] **Step 3: Implement filters**

Create `src/modules/repricing-engine/filters.ts`:

```typescript
import type { OrderBookAd } from '../../bybit/types.js';
import type { OrderBookFilters } from './types.js';

const PRICE_FLOOR = 8;
const PRICE_CEILING = 12;

export function applyFilters(
  ads: OrderBookAd[],
  filters: OrderBookFilters,
  selfUserId: string,
): OrderBookAd[] {
  return ads.filter((ad) => {
    // Exclude own ads
    if (ad.userId === selfUserId) return false;

    // Exclude outlier prices
    if (ad.price < PRICE_FLOOR || ad.price > PRICE_CEILING) return false;

    // Filter 1: min order amount
    if (ad.maxAmount < filters.minOrderAmount) return false;

    // Filter 2: verified only
    if (filters.verifiedOnly && ad.authStatus !== 2) return false;

    // Filter 3: min completion rate
    if (ad.recentExecuteRate < filters.minCompletionRate) return false;

    // Filter 4: min order count
    if (ad.recentOrderNum < filters.minOrderCount) return false;

    // Filter 5: merchant levels
    if (filters.merchantLevels.length > 0) {
      const hasMatchingTag = ad.authTag.some((tag) => filters.merchantLevels.includes(tag));
      if (!hasMatchingTag) return false;
    }

    return true;
  });
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/modules/repricing-engine/filters.test.ts`
Expected: 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/repricing-engine/filters.ts tests/modules/repricing-engine/filters.test.ts
git commit -m "feat(repricing): order book filters — 5 configurable filters with outlier/self exclusion"
```

---

## Task 4: Phase Functions

**Files:**
- Create: `src/modules/repricing-engine/phases.ts`
- Test: `tests/modules/repricing-engine/phases.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/modules/repricing-engine/phases.test.ts`:

```typescript
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
  id: '1', side: 'sell', price, quantity, minAmount: 10, maxAmount: 5000,
  nickName, userId: 'u1', recentOrderNum: 50, recentExecuteRate: 95,
  authTag: ['GA'], authStatus: 2, isOnline: true, userType: 'PERSONAL',
});

describe('calculatePosition', () => {
  it('returns position in sorted sell ads (ascending)', () => {
    const ads = [makeAd(9.343), makeAd(9.344), makeAd(9.346)];
    expect(calculatePosition(ads, 9.345, 'sell')).toBe(3); // between 9.344 and 9.346
  });

  it('returns 1 when price is best', () => {
    const ads = [makeAd(9.343), makeAd(9.344)];
    expect(calculatePosition(ads, 9.340, 'sell')).toBe(1);
  });

  it('returns position in sorted buy ads (descending)', () => {
    const ads = [makeAd(9.343), makeAd(9.340), makeAd(9.338)];
    expect(calculatePosition(ads, 9.341, 'buy')).toBe(2);
  });
});

describe('checkSpread', () => {
  it('returns spread between best ask and best bid', () => {
    const sell = [makeAd(9.343), makeAd(9.345)];
    const buy = [makeAd(9.340), makeAd(9.338)];
    expect(checkSpread(sell, buy)).toBeCloseTo(0.003, 4);
  });

  it('returns null when either side is empty', () => {
    expect(checkSpread([], [makeAd(9.340)])).toBeNull();
  });
});

describe('assessVolume', () => {
  it('skips top position when quantity < 50 USDT', () => {
    const ads = [makeAd(9.340, 30), makeAd(9.341, 500)];
    const result = assessVolume(ads, 'sell');
    expect(result.effectiveTopPrice).toBe(9.341);
    expect(result.skippedThinTop).toBe(true);
  });

  it('keeps top position when quantity >= 50', () => {
    const ads = [makeAd(9.340, 500), makeAd(9.341, 500)];
    const result = assessVolume(ads, 'sell');
    expect(result.effectiveTopPrice).toBe(9.340);
    expect(result.skippedThinTop).toBe(false);
  });
});

describe('detectAggressive', () => {
  it('detects outlier when gap is > 2x median', () => {
    // Prices: 9.330, 9.343, 9.344, 9.345  → gap 0.013 vs median ~0.001
    const ads = [makeAd(9.330, 500, 'kamikaze'), makeAd(9.343), makeAd(9.344), makeAd(9.345)];
    const result = detectAggressive(ads, 'sell');
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].nickName).toBe('kamikaze');
    expect(result.remaining).toHaveLength(3);
  });

  it('returns empty excluded when no outlier', () => {
    const ads = [makeAd(9.343), makeAd(9.344), makeAd(9.345)];
    const result = detectAggressive(ads, 'sell');
    expect(result.excluded).toHaveLength(0);
    expect(result.remaining).toHaveLength(3);
  });

  it('does not exclude when fewer than 3 ads', () => {
    const ads = [makeAd(9.330), makeAd(9.345)];
    const result = detectAggressive(ads, 'sell');
    expect(result.excluded).toHaveLength(0);
  });
});

describe('calculateOptimalPrice', () => {
  it('conservative mode targets position #3', () => {
    const ads = [makeAd(9.343), makeAd(9.344), makeAd(9.345), makeAd(9.346)];
    const price = calculateOptimalPrice(ads, 'sell', 3);
    expect(price).toBe(9.344); // match #3, which undercuts the 3rd competitor at 9.345
  });

  it('aggressive mode undercuts position #1 by 0.001', () => {
    const ads = [makeAd(9.343), makeAd(9.344)];
    const price = calculateOptimalPrice(ads, 'sell', 1);
    expect(price).toBe(9.342); // undercut #1 (9.343) by 0.001
  });

  it('buy side outbids position #1 by 0.001', () => {
    const ads = [makeAd(9.343), makeAd(9.340)];
    const price = calculateOptimalPrice(ads, 'buy', 1);
    expect(price).toBe(9.344); // outbid #1 (9.343) by 0.001
  });

  it('falls back to #1 when fewer competitors than target', () => {
    const ads = [makeAd(9.343)];
    const price = calculateOptimalPrice(ads, 'sell', 3);
    expect(price).toBe(9.342); // only 1 competitor, undercut them
  });
});

describe('applySafetyBounds', () => {
  it('returns prices unchanged when spread is within bounds', () => {
    const result = applySafetyBounds(9.335, 9.350, 0.010, 0.050);
    expect(result.buyPrice).toBe(9.335);
    expect(result.sellPrice).toBe(9.350);
  });

  it('adjusts prices when spread < minSpread', () => {
    const result = applySafetyBounds(9.344, 9.345, 0.010, 0.050);
    // Spread is 0.001, should widen to minSpread 0.010
    expect(result.sellPrice - result.buyPrice).toBeGreaterThanOrEqual(0.010);
  });

  it('rounds to 3 decimal places', () => {
    const result = applySafetyBounds(9.3351, 9.3489, 0.010, 0.050);
    expect(result.buyPrice).toBe(9.335);
    expect(result.sellPrice).toBe(9.349);
  });
});

describe('checkAntiOscillation', () => {
  it('returns hold when both price changes are below threshold', () => {
    expect(checkAntiOscillation(9.345, 9.346, 9.345, 9.346, 0.003)).toBe(true);
  });

  it('returns false when buy price change exceeds threshold', () => {
    expect(checkAntiOscillation(9.340, 9.346, 9.345, 9.346, 0.003)).toBe(false);
  });

  it('returns false when current prices are null (first run)', () => {
    expect(checkAntiOscillation(9.340, 9.346, null, null, 0.003)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/repricing-engine/phases.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement phases**

Create `src/modules/repricing-engine/phases.ts`:

```typescript
import type { OrderBookAd } from '../../bybit/types.js';
import type { Side } from '../../event-bus.js';

const THIN_VOLUME_THRESHOLD = 50; // USDT

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Phase 3: Calculate position in sorted order book */
export function calculatePosition(ads: OrderBookAd[], myPrice: number, side: Side): number {
  const sorted = [...ads].sort((a, b) =>
    side === 'sell' ? a.price - b.price : b.price - a.price,
  );
  let position = 1;
  for (const ad of sorted) {
    if (side === 'sell' && myPrice <= ad.price) break;
    if (side === 'buy' && myPrice >= ad.price) break;
    position++;
  }
  return position;
}

/** Phase 4: Check spread between best ask and best bid */
export function checkSpread(sellAds: OrderBookAd[], buyAds: OrderBookAd[]): number | null {
  if (sellAds.length === 0 || buyAds.length === 0) return null;
  const bestAsk = Math.min(...sellAds.map((a) => a.price));
  const bestBid = Math.max(...buyAds.map((a) => a.price));
  return bestAsk - bestBid;
}

/** Phase 5: Assess volume — skip top position if quantity is thin */
export function assessVolume(
  ads: OrderBookAd[],
  side: Side,
): { effectiveTopPrice: number; skippedThinTop: boolean } {
  const sorted = [...ads].sort((a, b) =>
    side === 'sell' ? a.price - b.price : b.price - a.price,
  );

  if (sorted.length === 0) {
    return { effectiveTopPrice: 0, skippedThinTop: false };
  }

  if (sorted[0].quantity < THIN_VOLUME_THRESHOLD && sorted.length > 1) {
    return { effectiveTopPrice: sorted[1].price, skippedThinTop: true };
  }

  return { effectiveTopPrice: sorted[0].price, skippedThinTop: false };
}

/** Phase 6: Detect aggressive competitors (outlier pricing) */
export function detectAggressive(
  ads: OrderBookAd[],
  side: Side,
): { excluded: Array<{ nickName: string; price: number; gap: number }>; remaining: OrderBookAd[] } {
  if (ads.length < 3) {
    return { excluded: [], remaining: ads };
  }

  const sorted = [...ads].sort((a, b) =>
    side === 'sell' ? a.price - b.price : b.price - a.price,
  );

  // Calculate gaps between consecutive prices
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(Math.abs(sorted[i].price - sorted[i - 1].price));
  }

  const firstGap = gaps[0];
  const restGaps = gaps.slice(1);

  if (restGaps.length === 0) {
    return { excluded: [], remaining: ads };
  }

  // Median of remaining gaps
  const sortedRest = [...restGaps].sort((a, b) => a - b);
  const median = sortedRest[Math.floor(sortedRest.length / 2)];

  // If first gap is > 2x median, the top position is aggressive
  if (median > 0 && firstGap > 2 * median) {
    const aggressive = sorted[0];
    return {
      excluded: [{ nickName: aggressive.nickName, price: aggressive.price, gap: firstGap }],
      remaining: sorted.slice(1),
    };
  }

  return { excluded: [], remaining: ads };
}

/** Phase 7: Calculate optimal price based on target position */
export function calculateOptimalPrice(
  ads: OrderBookAd[],
  side: Side,
  targetPosition: number,
): number {
  const sorted = [...ads].sort((a, b) =>
    side === 'sell' ? a.price - b.price : b.price - a.price,
  );

  // Use target position or fall back to #1 if not enough competitors
  const idx = Math.min(targetPosition, sorted.length) - 1;
  const targetPrice = sorted[idx].price;

  // Undercut (sell) or outbid (buy) by 0.001
  if (side === 'sell') {
    return round3(targetPrice - 0.001);
  } else {
    return round3(targetPrice + 0.001);
  }
}

/** Phase 8: Clamp prices to safety bounds */
export function applySafetyBounds(
  buyPrice: number,
  sellPrice: number,
  minSpread: number,
  maxSpread: number,
): { buyPrice: number; sellPrice: number } {
  let spread = sellPrice - buyPrice;

  if (spread < minSpread) {
    const mid = (buyPrice + sellPrice) / 2;
    buyPrice = mid - minSpread / 2;
    sellPrice = mid + minSpread / 2;
    spread = minSpread;
  }

  if (spread > maxSpread) {
    const mid = (buyPrice + sellPrice) / 2;
    buyPrice = mid - maxSpread / 2;
    sellPrice = mid + maxSpread / 2;
  }

  return { buyPrice: round3(buyPrice), sellPrice: round3(sellPrice) };
}

/** Phase 10: Check if price change is below anti-oscillation threshold */
export function checkAntiOscillation(
  newBuy: number,
  newSell: number,
  currentBuy: number | null,
  currentSell: number | null,
  threshold: number,
): boolean {
  if (currentBuy === null || currentSell === null) return false; // first run, always reprice

  const buyDelta = Math.abs(newBuy - currentBuy);
  const sellDelta = Math.abs(newSell - currentSell);

  return buyDelta < threshold && sellDelta < threshold;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/modules/repricing-engine/phases.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/repricing-engine/phases.ts tests/modules/repricing-engine/phases.test.ts
git commit -m "feat(repricing): phase functions — position, spread, volume, aggression, pricing, bounds, anti-oscillation"
```

---

## Task 5: RepricingEngine Class

**Files:**
- Create: `src/modules/repricing-engine/index.ts`
- Test: `tests/modules/repricing-engine/index.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/modules/repricing-engine/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepricingEngine } from '../../../src/modules/repricing-engine/index.js';
import type { OrderBookAd } from '../../../src/bybit/types.js';
import type { RepricingConfig } from '../../../src/modules/repricing-engine/types.js';
import { DEFAULT_FILTERS } from '../../../src/modules/repricing-engine/types.js';

const makeSellAd = (price: number, nickName = 'seller', overrides: Partial<OrderBookAd> = {}): OrderBookAd => ({
  id: `sell-${price}`, side: 'sell', price, quantity: 500, minAmount: 10, maxAmount: 5000,
  nickName, userId: `u-${nickName}`, recentOrderNum: 50, recentExecuteRate: 95,
  authTag: ['GA'], authStatus: 2, isOnline: true, userType: 'PERSONAL', ...overrides,
});

const makeBuyAd = (price: number, nickName = 'buyer', overrides: Partial<OrderBookAd> = {}): OrderBookAd => ({
  id: `buy-${price}`, side: 'buy', price, quantity: 500, minAmount: 10, maxAmount: 5000,
  nickName, userId: `u-${nickName}`, recentOrderNum: 50, recentExecuteRate: 95,
  authTag: ['GA'], authStatus: 2, isOnline: true, userType: 'PERSONAL', ...overrides,
});

describe('RepricingEngine', () => {
  let engine: RepricingEngine;
  let mockFetchOrderBook: ReturnType<typeof vi.fn>;
  const config: RepricingConfig = {
    mode: 'conservative',
    targetPosition: 3,
    antiOscillationThreshold: 0.003,
    minSpread: 0.010,
    maxSpread: 0.050,
    filters: DEFAULT_FILTERS,
    selfUserId: 'self-id',
  };

  beforeEach(() => {
    mockFetchOrderBook = vi.fn();
    engine = new RepricingEngine(config, mockFetchOrderBook);
  });

  it('returns reprice with valid order book and spread', async () => {
    mockFetchOrderBook.mockResolvedValue({
      sell: [makeSellAd(9.343), makeSellAd(9.344, 's2'), makeSellAd(9.345, 's3'), makeSellAd(9.346, 's4')],
      buy: [makeBuyAd(9.335), makeBuyAd(9.333, 'b2'), makeBuyAd(9.330, 'b3')],
    });

    const result = await engine.reprice({ buy: null, sell: null });
    expect(result.action).toBe('reprice');
    expect(result.buyPrice).toBeGreaterThan(0);
    expect(result.sellPrice).toBeGreaterThan(result.buyPrice);
    expect(result.spread).toBeGreaterThanOrEqual(0.010);
  });

  it('returns hold when fetch fails', async () => {
    mockFetchOrderBook.mockRejectedValue(new Error('network'));
    const result = await engine.reprice({ buy: 9.335, sell: 9.345 });
    expect(result.action).toBe('hold');
    expect(result.reason).toContain('fetch');
  });

  it('returns hold when filtered book is empty', async () => {
    mockFetchOrderBook.mockResolvedValue({
      sell: [makeSellAd(9.343, 'bad', { recentOrderNum: 1 })], // fails minOrderCount filter
      buy: [makeBuyAd(9.335)],
    });
    const result = await engine.reprice({ buy: null, sell: null });
    expect(result.action).toBe('hold');
  });

  it('returns pause when spread < minSpread', async () => {
    mockFetchOrderBook.mockResolvedValue({
      sell: [makeSellAd(9.343), makeSellAd(9.344, 's2')],
      buy: [makeBuyAd(9.343), makeBuyAd(9.340, 'b2')],  // spread = 0
    });
    const result = await engine.reprice({ buy: null, sell: null });
    expect(result.action).toBe('pause');
    expect(result.reason).toContain('spread');
  });

  it('returns hold when anti-oscillation triggers', async () => {
    mockFetchOrderBook.mockResolvedValue({
      sell: [makeSellAd(9.345), makeSellAd(9.346, 's2'), makeSellAd(9.347, 's3')],
      buy: [makeBuyAd(9.335), makeBuyAd(9.333, 'b2'), makeBuyAd(9.330, 'b3')],
    });

    // First run — always reprices
    const r1 = await engine.reprice({ buy: null, sell: null });
    expect(r1.action).toBe('reprice');

    // Second run with same prices — should hold
    const r2 = await engine.reprice({ buy: r1.buyPrice, sell: r1.sellPrice });
    expect(r2.action).toBe('hold');
  });

  it('detects aggressive competitor and excludes them', async () => {
    mockFetchOrderBook.mockResolvedValue({
      sell: [makeSellAd(9.320, 'kamikaze'), makeSellAd(9.343, 's2'), makeSellAd(9.344, 's3'), makeSellAd(9.345, 's4')],
      buy: [makeBuyAd(9.310), makeBuyAd(9.308, 'b2'), makeBuyAd(9.305, 'b3')],
    });

    const result = await engine.reprice({ buy: null, sell: null });
    expect(result.excludedAggressive.length).toBeGreaterThan(0);
    expect(result.excludedAggressive[0].nickName).toBe('kamikaze');
  });

  it('tracks position in filtered order book', async () => {
    mockFetchOrderBook.mockResolvedValue({
      sell: [makeSellAd(9.343), makeSellAd(9.344, 's2'), makeSellAd(9.345, 's3')],
      buy: [makeBuyAd(9.335), makeBuyAd(9.333, 'b2'), makeBuyAd(9.330, 'b3')],
    });

    const result = await engine.reprice({ buy: null, sell: null });
    expect(result.position.sell).toBeGreaterThan(0);
    expect(result.position.buy).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/repricing-engine/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement RepricingEngine**

Create `src/modules/repricing-engine/index.ts`:

```typescript
import type { OrderBookAd } from '../../bybit/types.js';
import type { Side } from '../../event-bus.js';
import {
  type RepricingConfig,
  type RepricingResult,
  type CurrentAdPrices,
  type PhaseTrace,
  type RepricingMode,
  type OrderBookFilters,
  DEFAULT_FILTERS,
  MODE_PRESETS,
} from './types.js';
import { applyFilters } from './filters.js';
import {
  calculatePosition,
  checkSpread,
  assessVolume,
  detectAggressive,
  calculateOptimalPrice,
  applySafetyBounds,
  checkAntiOscillation,
} from './phases.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('repricing-engine');

type FetchOrderBook = () => Promise<{ sell: OrderBookAd[]; buy: OrderBookAd[] }>;

export class RepricingEngine {
  private config: RepricingConfig;
  private fetchOrderBook: FetchOrderBook;
  private lastResult: RepricingResult | null = null;
  private lastSellAds: OrderBookAd[] = [];
  private lastBuyAds: OrderBookAd[] = [];

  constructor(config: RepricingConfig, fetchOrderBook: FetchOrderBook) {
    this.config = config;
    this.fetchOrderBook = fetchOrderBook;
  }

  async reprice(currentPrices: CurrentAdPrices): Promise<RepricingResult> {
    const phases: PhaseTrace[] = [];
    const excludedAggressive: RepricingResult['excludedAggressive'] = [];

    // Phase 1 — FETCH
    let rawSell: OrderBookAd[];
    let rawBuy: OrderBookAd[];
    const p1Start = Date.now();
    try {
      const book = await this.fetchOrderBook();
      rawSell = book.sell;
      rawBuy = book.buy;
      phases.push({ phase: 1, name: 'FETCH', result: `sell:${rawSell.length} buy:${rawBuy.length}`, durationMs: Date.now() - p1Start });
    } catch (err) {
      phases.push({ phase: 1, name: 'FETCH', result: 'failed', durationMs: Date.now() - p1Start });
      return this.result(0, 0, 0, { buy: 0, sell: 0 }, { buy: 0, sell: 0 }, 'hold', 'fetch failed — keeping current prices', phases, excludedAggressive);
    }

    // Phase 2 — FILTER
    const p2Start = Date.now();
    const filteredSell = applyFilters(rawSell, this.config.filters, this.config.selfUserId);
    const filteredBuy = applyFilters(rawBuy, this.config.filters, this.config.selfUserId);
    phases.push({ phase: 2, name: 'FILTER', result: `sell:${filteredSell.length}/${rawSell.length} buy:${filteredBuy.length}/${rawBuy.length}`, durationMs: Date.now() - p2Start });

    if (filteredSell.length === 0 || filteredBuy.length === 0) {
      return this.result(0, 0, 0, { buy: 0, sell: 0 }, { buy: filteredBuy.length, sell: filteredSell.length }, 'hold', 'filtered order book empty', phases, excludedAggressive);
    }

    this.lastSellAds = filteredSell;
    this.lastBuyAds = filteredBuy;

    // Phase 4 — SPREAD
    const p4Start = Date.now();
    const spread = checkSpread(filteredSell, filteredBuy);
    phases.push({ phase: 4, name: 'SPREAD', result: spread !== null ? `${spread.toFixed(4)} BOB` : 'null', durationMs: Date.now() - p4Start });

    if (spread !== null && spread < this.config.minSpread) {
      return this.result(0, 0, spread, { buy: 0, sell: 0 }, { buy: filteredBuy.length, sell: filteredSell.length }, 'pause', `spread ${spread.toFixed(4)} < min ${this.config.minSpread}`, phases, excludedAggressive);
    }

    // Phase 5 — VOLUME
    const p5Start = Date.now();
    const sellVolume = assessVolume(filteredSell, 'sell');
    const buyVolume = assessVolume(filteredBuy, 'buy');
    phases.push({ phase: 5, name: 'VOLUME', result: `sellTop:${sellVolume.effectiveTopPrice} buyTop:${buyVolume.effectiveTopPrice} skipSell:${sellVolume.skippedThinTop} skipBuy:${buyVolume.skippedThinTop}`, durationMs: Date.now() - p5Start });

    // Phase 6 — AGGRESSION DETECT
    const p6Start = Date.now();
    const sellAggression = detectAggressive(filteredSell, 'sell');
    const buyAggression = detectAggressive(filteredBuy, 'buy');
    const workingSell = sellAggression.remaining;
    const workingBuy = buyAggression.remaining;

    for (const ex of sellAggression.excluded) {
      excludedAggressive.push({ side: 'sell' as Side, ...ex });
    }
    for (const ex of buyAggression.excluded) {
      excludedAggressive.push({ side: 'buy' as Side, ...ex });
    }
    phases.push({ phase: 6, name: 'AGGRESSION', result: `excluded:${excludedAggressive.length}`, durationMs: Date.now() - p6Start });

    if (workingSell.length === 0 || workingBuy.length === 0) {
      return this.result(0, 0, 0, { buy: 0, sell: 0 }, { buy: filteredBuy.length, sell: filteredSell.length }, 'hold', 'no competitors after aggression filter', phases, excludedAggressive);
    }

    // Phase 7 — OPTIMAL PRICE
    const p7Start = Date.now();
    let sellPrice = calculateOptimalPrice(workingSell, 'sell', this.config.targetPosition);
    let buyPrice = calculateOptimalPrice(workingBuy, 'buy', this.config.targetPosition);
    phases.push({ phase: 7, name: 'OPTIMAL', result: `buy:${buyPrice} sell:${sellPrice}`, durationMs: Date.now() - p7Start });

    // Phase 8 — SAFETY BOUNDS
    const p8Start = Date.now();
    const bounded = applySafetyBounds(buyPrice, sellPrice, this.config.minSpread, this.config.maxSpread);
    buyPrice = bounded.buyPrice;
    sellPrice = bounded.sellPrice;
    phases.push({ phase: 8, name: 'BOUNDS', result: `buy:${buyPrice} sell:${sellPrice}`, durationMs: Date.now() - p8Start });

    // Phase 9 — PROFITABILITY
    if (buyPrice >= sellPrice) {
      phases.push({ phase: 9, name: 'PROFIT', result: 'inversion', durationMs: 0 });
      return this.result(buyPrice, sellPrice, 0, { buy: 0, sell: 0 }, { buy: filteredBuy.length, sell: filteredSell.length }, 'pause', 'price inversion after bounds', phases, excludedAggressive);
    }
    phases.push({ phase: 9, name: 'PROFIT', result: 'ok', durationMs: 0 });

    // Phase 3 — POSITION (calculated with final prices)
    const p3Start = Date.now();
    const position = {
      sell: calculatePosition(workingSell, sellPrice, 'sell'),
      buy: calculatePosition(workingBuy, buyPrice, 'buy'),
    };
    phases.push({ phase: 3, name: 'POSITION', result: `sell:#${position.sell} buy:#${position.buy}`, durationMs: Date.now() - p3Start });

    // Phase 10 — ANTI-OSCILLATION
    const p10Start = Date.now();
    const shouldHold = checkAntiOscillation(buyPrice, sellPrice, currentPrices.buy, currentPrices.sell, this.config.antiOscillationThreshold);
    phases.push({ phase: 10, name: 'ANTI-OSC', result: shouldHold ? 'hold' : 'reprice', durationMs: Date.now() - p10Start });

    if (shouldHold) {
      return this.result(buyPrice, sellPrice, sellPrice - buyPrice, position, { buy: filteredBuy.length, sell: filteredSell.length }, 'hold', `anti-oscillation: changes below ${this.config.antiOscillationThreshold}`, phases, excludedAggressive);
    }

    // Phase 11 — RETURN
    const finalSpread = sellPrice - buyPrice;
    const r = this.result(buyPrice, sellPrice, finalSpread, position, { buy: filteredBuy.length, sell: filteredSell.length }, 'reprice', `target position ${this.config.targetPosition}`, phases, excludedAggressive);
    this.lastResult = r;
    return r;
  }

  private result(
    buyPrice: number, sellPrice: number, spread: number,
    position: { buy: number; sell: number },
    filteredCompetitors: { buy: number; sell: number },
    action: 'reprice' | 'hold' | 'pause',
    reason: string,
    phases: PhaseTrace[],
    excludedAggressive: RepricingResult['excludedAggressive'],
  ): RepricingResult {
    return {
      buyPrice, sellPrice, spread, position, filteredCompetitors,
      action, mode: this.config.mode, reason, phases, excludedAggressive,
    };
  }

  getLastResult(): RepricingResult | null {
    return this.lastResult;
  }

  getFilteredOrderBook(): { sell: OrderBookAd[]; buy: OrderBookAd[] } {
    return { sell: this.lastSellAds, buy: this.lastBuyAds };
  }

  updateConfig(partial: Partial<RepricingConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.mode) {
      const preset = MODE_PRESETS[partial.mode];
      this.config.targetPosition = partial.targetPosition ?? preset.targetPosition;
      this.config.antiOscillationThreshold = partial.antiOscillationThreshold ?? preset.antiOscillationThreshold;
    }
    log.info({ config: this.config }, 'Repricing config updated');
  }

  getConfig(): RepricingConfig {
    return { ...this.config };
  }
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/modules/repricing-engine/index.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/repricing-engine/index.ts tests/modules/repricing-engine/index.test.ts
git commit -m "feat(repricing): RepricingEngine class — 12-phase pipeline with config management"
```

---

## Task 6: Add reprice:cycle Event + Telegram Notifications

**Files:**
- Modify: `src/event-bus.ts`
- Modify: `src/modules/telegram/index.ts`

- [ ] **Step 1: Add event to EventMap**

In `src/event-bus.ts`, add before the closing `}` of `EventMap`:

```typescript
  // Repricing engine events
  'reprice:cycle': {
    action: 'reprice' | 'hold' | 'pause';
    buyPrice: number;
    sellPrice: number;
    spread: number;
    position: { buy: number; sell: number };
    filteredCompetitors: { buy: number; sell: number };
    mode: string;
    reason: string;
  };
```

- [ ] **Step 2: Add Telegram listener for reprice:cycle**

In `src/modules/telegram/index.ts`, in the `setupEventListeners()` method, add:

```typescript
    let lastPosition = { buy: 0, sell: 0 };

    this.bus.on('reprice:cycle', (payload) => {
      // Notify on position changes (>= 2 positions shift)
      const buyShift = Math.abs(payload.position.buy - lastPosition.buy);
      const sellShift = Math.abs(payload.position.sell - lastPosition.sell);

      if ((buyShift >= 2 || sellShift >= 2) && payload.action === 'reprice') {
        void this.send(
          `📊 Position: SELL #${payload.position.sell} BUY #${payload.position.buy} | ` +
          `Spread: ${payload.spread.toFixed(3)} BOB | Mode: ${payload.mode}`
        );
      }

      lastPosition = { ...payload.position };
    });
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/event-bus.ts src/modules/telegram/index.ts
git commit -m "feat(repricing): add reprice:cycle event and Telegram position change notifications"
```

---

## Task 7: REST API Routes

**Files:**
- Create: `src/api/routes/repricing.ts`

- [ ] **Step 1: Create repricing routes**

Create `src/api/routes/repricing.ts`:

```typescript
import { Router } from 'express';
import type { RepricingEngine } from '../../modules/repricing-engine/index.js';

export interface RepricingDeps {
  engine: RepricingEngine;
}

export function createRepricingRouter(deps: RepricingDeps): Router {
  const router = Router();

  // GET /api/repricing/config
  router.get('/repricing/config', (_req, res) => {
    const config = deps.engine.getConfig();
    res.json({
      mode: config.mode,
      targetPosition: config.targetPosition,
      antiOscillationThreshold: config.antiOscillationThreshold,
      minSpread: config.minSpread,
      maxSpread: config.maxSpread,
      filters: config.filters,
    });
  });

  // PUT /api/repricing/config
  router.put('/repricing/config', (req, res) => {
    const body = req.body;
    const update: Record<string, any> = {};

    if (body.mode) update.mode = body.mode;
    if (body.targetPosition !== undefined) update.targetPosition = Number(body.targetPosition);
    if (body.antiOscillationThreshold !== undefined) update.antiOscillationThreshold = Number(body.antiOscillationThreshold);
    if (body.minSpread !== undefined) update.minSpread = Number(body.minSpread);
    if (body.maxSpread !== undefined) update.maxSpread = Number(body.maxSpread);
    if (body.filters) {
      const currentConfig = deps.engine.getConfig();
      update.filters = { ...currentConfig.filters, ...body.filters };
      if (body.filters.merchantLevels && typeof body.filters.merchantLevels === 'string') {
        update.filters.merchantLevels = body.filters.merchantLevels.split(',');
      }
    }

    deps.engine.updateConfig(update);
    res.json({ ok: true, config: deps.engine.getConfig() });
  });

  // GET /api/repricing/status
  router.get('/repricing/status', (_req, res) => {
    const lastResult = deps.engine.getLastResult();
    if (!lastResult) {
      res.json({ action: 'none', reason: 'no cycle yet' });
      return;
    }
    res.json({
      ...lastResult,
      phases: undefined, // don't expose phase traces in status
      lastCycleAt: new Date().toISOString(),
    });
  });

  // GET /api/repricing/orderbook
  router.get('/repricing/orderbook', (_req, res) => {
    const book = deps.engine.getFilteredOrderBook();
    const lastResult = deps.engine.getLastResult();

    const formatSide = (ads: any[], side: string) =>
      ads
        .sort((a: any, b: any) => side === 'sell' ? a.price - b.price : b.price - a.price)
        .map((ad: any, i: number) => ({
          rank: i + 1,
          price: ad.price,
          quantity: ad.quantity,
          nickName: ad.nickName,
          completionRate: ad.recentExecuteRate,
          orders: ad.recentOrderNum,
        }));

    res.json({
      sell: formatSide(book.sell, 'sell'),
      buy: formatSide(book.buy, 'buy'),
      excludedAggressive: lastResult?.excludedAggressive ?? [],
      totalFiltered: { sell: book.sell.length, buy: book.buy.length },
    });
  });

  return router;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/routes/repricing.ts
git commit -m "feat(repricing): REST API routes — GET/PUT config, GET status, GET orderbook"
```

---

## Task 8: Wire Engine into AdManager + index.ts

**Files:**
- Modify: `src/modules/ad-manager/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Simplify AdManager tick()**

In `src/modules/ad-manager/index.ts`:

1. Add import: `import type { RepricingEngine } from '../repricing-engine/index.js';`
2. Add a private field: `private engine: RepricingEngine | null = null;`
3. Add setter: `setEngine(engine: RepricingEngine): void { this.engine = engine; }`
4. Replace the `tick()` method body with:

```typescript
  async tick(): Promise<void> {
    // If engine is set, delegate to it
    if (this.engine) {
      try {
        const currentPrices = {
          buy: this.activeAds.get('buy')?.price ?? null,
          sell: this.activeAds.get('sell')?.price ?? null,
        };

        const result = await this.engine.reprice(currentPrices);

        // Phase 12 — LOG: emit event
        await this.bus.emit('reprice:cycle', {
          action: result.action,
          buyPrice: result.buyPrice,
          sellPrice: result.sellPrice,
          spread: result.spread,
          position: result.position,
          filteredCompetitors: result.filteredCompetitors,
          mode: result.mode,
          reason: result.reason,
        }, MODULE);

        switch (result.action) {
          case 'reprice':
            for (const side of ['buy', 'sell'] as Side[]) {
              const price = side === 'buy' ? result.buyPrice : result.sellPrice;
              const manualPaused = this.pausedSides.get(side) ?? false;
              await this.manageSide(side, price, manualPaused);
            }
            break;
          case 'hold':
            log.debug({ reason: result.reason }, 'Repricing held');
            break;
          case 'pause':
            log.info({ reason: result.reason }, 'Repricing paused — removing ads');
            await this.removeAllAds();
            await this.bus.emit('ad:paused', { side: 'buy' as Side, reason: result.reason }, MODULE);
            await this.bus.emit('ad:paused', { side: 'sell' as Side, reason: result.reason }, MODULE);
            break;
        }
        return;
      } catch (err) {
        log.error({ err }, 'Repricing engine error — falling back to legacy pricing');
      }
    }

    // Legacy fallback (when engine is not set)
    if (this.latestPrices.length === 0) {
      log.debug('No prices yet — skipping tick');
      return;
    }

    // ... keep existing legacy tick code below ...
```

Keep the existing `checkBybitMarketSpread()`, `getCurrentPrices()` and CriptoYa fallback code below the new code as the legacy path. This ensures the bot works even without the engine.

- [ ] **Step 2: Wire engine in index.ts**

In `src/index.ts`:

1. Add imports:
```typescript
import { RepricingEngine } from './modules/repricing-engine/index.js';
import { createRepricingRouter } from './api/routes/repricing.js';
```

2. After `adManager` creation, create the engine:
```typescript
// Repricing engine
const repricingEngine = new RepricingEngine(
  {
    mode: (await getConfig('reprice_mode') || 'conservative') as any,
    targetPosition: parseInt(await getConfig('target_position') || '3'),
    antiOscillationThreshold: parseFloat(await getConfig('anti_oscillation_threshold') || '0.003'),
    minSpread,
    maxSpread,
    filters: {
      minOrderAmount: parseInt(await getConfig('filter_min_order_amount') || '100'),
      verifiedOnly: (await getConfig('filter_verified_only')) !== 'false',
      minCompletionRate: parseInt(await getConfig('filter_min_completion_rate') || '80'),
      minOrderCount: parseInt(await getConfig('filter_min_order_count') || '10'),
      merchantLevels: (await getConfig('filter_merchant_levels') || 'GA,VA').split(','),
    },
    selfUserId: envConfig.bybit.userId,
  },
  async () => {
    const [sell, buy] = await Promise.all([
      bybitClient.getOnlineAdsEnriched('sell', 'USDT', 'BOB'),
      bybitClient.getOnlineAdsEnriched('buy', 'USDT', 'BOB'),
    ]);
    return { sell, buy };
  },
);

// Connect engine to AdManager
adManager.setEngine(repricingEngine);
```

3. Register the repricing API router alongside existing routes:
```typescript
app.use('/api', createRepricingRouter({ engine: repricingEngine }));
```

4. Seed the new config keys in the startup config seeding block:
```typescript
const REPRICING_DEFAULTS: Record<string, string> = {
  reprice_mode: 'conservative',
  target_position: '3',
  anti_oscillation_threshold: '0.003',
  filter_min_order_amount: '100',
  filter_verified_only: 'true',
  filter_min_completion_rate: '80',
  filter_min_order_count: '10',
  filter_merchant_levels: 'GA,VA',
};
```

- [ ] **Step 3: Verify typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: No errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/ad-manager/index.ts src/index.ts
git commit -m "feat(repricing): wire engine into AdManager and index.ts with REST API and config seeding"
```

---

## Task 9: Integration Smoke Test

**Files:**
- Modify: `tests/smoke.test.ts`

- [ ] **Step 1: Add repricing engine smoke test**

Add to the existing `tests/smoke.test.ts`:

```typescript
import { RepricingEngine } from '../src/modules/repricing-engine/index.js';
import { DEFAULT_FILTERS } from '../src/modules/repricing-engine/types.js';
import type { OrderBookAd } from '../src/bybit/types.js';

// Add inside the existing describe block:

  it('repricing engine runs 12-phase pipeline and returns valid result', async () => {
    const makeSellAd = (price: number, nick: string): OrderBookAd => ({
      id: `s-${price}`, side: 'sell', price, quantity: 500, minAmount: 10, maxAmount: 5000,
      nickName: nick, userId: `u-${nick}`, recentOrderNum: 50, recentExecuteRate: 95,
      authTag: ['GA'], authStatus: 2, isOnline: true, userType: 'PERSONAL',
    });
    const makeBuyAd = (price: number, nick: string): OrderBookAd => ({
      id: `b-${price}`, side: 'buy', price, quantity: 500, minAmount: 10, maxAmount: 5000,
      nickName: nick, userId: `u-${nick}`, recentOrderNum: 50, recentExecuteRate: 95,
      authTag: ['GA'], authStatus: 2, isOnline: true, userType: 'PERSONAL',
    });

    const engine = new RepricingEngine(
      {
        mode: 'conservative',
        targetPosition: 3,
        antiOscillationThreshold: 0.003,
        minSpread: 0.010,
        maxSpread: 0.050,
        filters: DEFAULT_FILTERS,
        selfUserId: 'self',
      },
      async () => ({
        sell: [makeSellAd(9.343, 'a'), makeSellAd(9.344, 'b'), makeSellAd(9.345, 'c'), makeSellAd(9.346, 'd')],
        buy: [makeBuyAd(9.330, 'e'), makeBuyAd(9.328, 'f'), makeBuyAd(9.325, 'g')],
      }),
    );

    const result = await engine.reprice({ buy: null, sell: null });

    expect(result.action).toBe('reprice');
    expect(result.buyPrice).toBeGreaterThan(0);
    expect(result.sellPrice).toBeGreaterThan(result.buyPrice);
    expect(result.spread).toBeGreaterThanOrEqual(0.010);
    expect(result.position.sell).toBeGreaterThan(0);
    expect(result.position.buy).toBeGreaterThan(0);
    expect(result.phases.length).toBeGreaterThan(0);
    expect(result.mode).toBe('conservative');
  });
```

- [ ] **Step 2: Run smoke test**

Run: `npx vitest run tests/smoke.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Run full suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/smoke.test.ts
git commit -m "test(repricing): add integration smoke test for 12-phase pipeline"
```
