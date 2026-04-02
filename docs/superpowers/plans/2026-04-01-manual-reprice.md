# Manual Reprice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-shot manual price override from the dashboard with 4-minute hold, Telegram notifications, and MANUAL indicator in the OperationsStrip.

**Architecture:** New state (`manualHoldUntil`, `manualHoldPrice` maps) and three methods in AdManager. Two new events on EventBus. Two new API endpoints in the repricing route. Dashboard gets hooks + UI in RepricingConfig panel + MANUAL tag in OperationsStrip.

**Tech Stack:** TypeScript, Express, React 19, React Query, Tailwind CSS, Vitest, Supertest

---

### Task 1: Add event types to EventBus

**Files:**
- Modify: `src/event-bus.ts:79-90` (add two entries to `EventMap`)

- [ ] **Step 1: Add the two new event types**

In `src/event-bus.ts`, add these two entries to the `EventMap` interface, after the existing `reprice:cycle` entry:

```ts
  // Manual reprice events
  'ad:manual-reprice': { side: Side; price: number; holdUntilMs: number };
  'ad:manual-hold-expired': { side: Side };
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/event-bus.ts
git commit -m "feat: add manual-reprice event types to EventBus"
```

---

### Task 2: Add manual hold state and methods to AdManager

**Files:**
- Modify: `src/modules/ad-manager/index.ts`

- [ ] **Step 1: Add manual hold state**

In `AdManager`, after the `imbalancePaused` map declaration (line ~76), add:

```ts
  /** Manual price override — holds a forced price for a fixed window */
  private manualHoldUntil: Map<Side, number> = new Map();
  private manualHoldPrice: Map<Side, number> = new Map();
```

- [ ] **Step 2: Add the `forceReprice` method**

In the "Runtime control" section (after `setRepriceEnabled`, around line ~578), add:

```ts
  async forceReprice(side: Side, price: number): Promise<void> {
    this.manualHoldUntil.set(side, Date.now() + 240_000);
    this.manualHoldPrice.set(side, price);
    await this.manageSide(side, price, false);
    await this.bus.emit('ad:manual-reprice', { side, price, holdUntilMs: 240_000 }, MODULE);
    log.info({ side, price, holdMinutes: 4 }, 'Manual reprice forced');
  }
```

- [ ] **Step 3: Add the `clearManualHold` method**

```ts
  clearManualHold(side: Side): void {
    this.manualHoldUntil.delete(side);
    this.manualHoldPrice.delete(side);
    log.info({ side }, 'Manual hold cleared');
  }
```

- [ ] **Step 4: Add the `getManualHold` accessor**

In the "Accessors" section (after `getImbalance`), add:

```ts
  getManualHold(): Record<Side, { price: number; holdUntil: number } | null> {
    const now = Date.now();
    const result: Record<Side, { price: number; holdUntil: number } | null> = { buy: null, sell: null };
    for (const side of ['buy', 'sell'] as Side[]) {
      const until = this.manualHoldUntil.get(side);
      const price = this.manualHoldPrice.get(side);
      if (until && price && until > now) {
        result[side] = { price, holdUntil: until };
      }
    }
    return result;
  }
```

- [ ] **Step 5: Add hold guard to the tick loop — repricing engine path**

In the `tick()` method, inside the repricing engine path where it iterates over sides and calls `manageSide` (around line ~239), wrap the `manageSide` call with a hold check. Replace:

```ts
            for (const side of ['buy', 'sell'] as Side[]) {
              const price = side === 'buy' ? result.buyPrice : result.sellPrice;
              const manualPaused = this.pausedSides.get(side) ?? false;
              await this.manageSide(side, price, manualPaused);
            }
```

with:

```ts
            for (const side of ['buy', 'sell'] as Side[]) {
              const holdUntil = this.manualHoldUntil.get(side);
              if (holdUntil && holdUntil > Date.now()) {
                log.debug({ side, remainingMs: holdUntil - Date.now() }, 'Skipping side — manual hold active');
                continue;
              }
              if (holdUntil && holdUntil <= Date.now()) {
                this.manualHoldUntil.delete(side);
                this.manualHoldPrice.delete(side);
                await this.bus.emit('ad:manual-hold-expired', { side }, MODULE);
                log.info({ side }, 'Manual hold expired — engine resumed');
              }
              const price = side === 'buy' ? result.buyPrice : result.sellPrice;
              const manualPaused = this.pausedSides.get(side) ?? false;
              await this.manageSide(side, price, manualPaused);
            }
```

- [ ] **Step 6: Add hold guard to the tick loop — legacy fallback path**

In the legacy fallback path (around line ~314), replace:

```ts
    for (const side of sides) {
      const price = side === 'buy' ? buyPrice : sellPrice;
      const manualPaused = this.pausedSides.get(side) ?? false;
      await this.manageSide(side, price, manualPaused);
    }
```

with:

```ts
    for (const side of sides) {
      const holdUntil = this.manualHoldUntil.get(side);
      if (holdUntil && holdUntil > Date.now()) {
        log.debug({ side, remainingMs: holdUntil - Date.now() }, 'Skipping side — manual hold active');
        continue;
      }
      if (holdUntil && holdUntil <= Date.now()) {
        this.manualHoldUntil.delete(side);
        this.manualHoldPrice.delete(side);
        await this.bus.emit('ad:manual-hold-expired', { side }, MODULE);
        log.info({ side }, 'Manual hold expired — engine resumed');
      }
      const price = side === 'buy' ? buyPrice : sellPrice;
      const manualPaused = this.pausedSides.get(side) ?? false;
      await this.manageSide(side, price, manualPaused);
    }
```

- [ ] **Step 7: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/modules/ad-manager/index.ts
git commit -m "feat: add manual hold state and methods to AdManager"
```

---

### Task 3: Wire Telegram notifications

**Files:**
- Modify: `src/modules/telegram/index.ts:141-198` (add two event listeners in `setupEventListeners`)

- [ ] **Step 1: Add event listeners**

In `setupEventListeners()` in `src/modules/telegram/index.ts`, after the `ad:repriced` listener (around line ~148), add:

```ts
    this.bus.on('ad:manual-reprice', (payload) => {
      void this.send(`🎯 Manual reprice: ${payload.side.toUpperCase()} → ${payload.price} BOB (holding 4 min)`);
    });

    this.bus.on('ad:manual-hold-expired', (payload) => {
      void this.send(`🔄 Manual hold expired (${payload.side.toUpperCase()}) — engine resumed`);
    });
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/telegram/index.ts
git commit -m "feat: wire manual reprice Telegram notifications"
```

---

### Task 4: Add API endpoints for force reprice

**Files:**
- Modify: `src/api/routes/repricing.ts`
- Modify: `src/api/index.ts:77` (pass adManager to repricing router)

- [ ] **Step 1: Update RepricingDeps and add endpoints**

In `src/api/routes/repricing.ts`, update the `RepricingDeps` interface and add the new routes. Replace the entire file with:

```ts
import { Router } from 'express';
import type { RepricingEngine } from '../../modules/repricing-engine/index.js';
import type { Side } from '../../event-bus.js';

export interface RepricingDeps {
  engine: RepricingEngine;
  adManager: {
    forceReprice: (side: Side, price: number) => Promise<void>;
    clearManualHold: (side: Side) => void;
    getManualHold: () => Record<Side, { price: number; holdUntil: number } | null>;
  };
}

export function createRepricingRouter(deps: RepricingDeps): Router {
  const router = Router();

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
      if (typeof body.filters.merchantLevels === 'string') {
        update.filters.merchantLevels = body.filters.merchantLevels.split(',');
      }
    }

    deps.engine.updateConfig(update);
    res.json({ ok: true, config: deps.engine.getConfig() });
  });

  router.get('/repricing/status', (_req, res) => {
    const lastResult = deps.engine.getLastResult();
    const hold = deps.adManager.getManualHold();
    const now = Date.now();

    const manualHold: Record<string, any> = {
      buy: hold.buy ? { price: hold.buy.price, holdUntil: new Date(hold.buy.holdUntil).toISOString(), remainingMs: hold.buy.holdUntil - now } : null,
      sell: hold.sell ? { price: hold.sell.price, holdUntil: new Date(hold.sell.holdUntil).toISOString(), remainingMs: hold.sell.holdUntil - now } : null,
    };

    if (!lastResult) {
      res.json({ action: 'none', reason: 'no cycle yet', manualHold });
      return;
    }
    res.json({
      action: lastResult.action,
      buyPrice: lastResult.buyPrice,
      sellPrice: lastResult.sellPrice,
      spread: lastResult.spread,
      position: lastResult.position,
      filteredCompetitors: lastResult.filteredCompetitors,
      mode: lastResult.mode,
      reason: lastResult.reason,
      excludedAggressive: lastResult.excludedAggressive,
      manualHold,
    });
  });

  router.post('/repricing/force', async (req, res) => {
    const body = req.body;

    // Two formats: { side, price } or { buy: price, sell: price }
    const sides: Array<{ side: Side; price: number }> = [];

    if (body.side && body.price !== undefined) {
      if (body.side !== 'buy' && body.side !== 'sell') {
        res.status(400).json({ error: `Invalid side: ${body.side}. Must be "buy" or "sell"` });
        return;
      }
      sides.push({ side: body.side, price: Number(body.price) });
    } else {
      if (body.buy !== undefined) sides.push({ side: 'buy', price: Number(body.buy) });
      if (body.sell !== undefined) sides.push({ side: 'sell', price: Number(body.sell) });
    }

    if (sides.length === 0) {
      res.status(400).json({ error: 'Must provide { side, price } or { buy: price } and/or { sell: price }' });
      return;
    }

    for (const { price } of sides) {
      if (!Number.isFinite(price) || price < 5 || price > 15) {
        res.status(400).json({ error: `Invalid price: ${price}. Must be between 5 and 15` });
        return;
      }
    }

    const results = [];
    for (const { side, price } of sides) {
      await deps.adManager.forceReprice(side, price);
      const hold = deps.adManager.getManualHold();
      results.push({
        ok: true,
        side,
        price,
        holdUntil: hold[side] ? new Date(hold[side].holdUntil).toISOString() : null,
      });
    }

    res.json(results.length === 1 ? results[0] : results);
  });

  router.post('/repricing/force/cancel', (req, res) => {
    const { side } = req.body;

    if (!side || (side !== 'buy' && side !== 'sell' && side !== 'both')) {
      res.status(400).json({ error: 'Must provide side: "buy", "sell", or "both"' });
      return;
    }

    if (side === 'both') {
      deps.adManager.clearManualHold('buy');
      deps.adManager.clearManualHold('sell');
    } else {
      deps.adManager.clearManualHold(side);
    }

    res.json({ ok: true, cleared: side });
  });

  router.get('/repricing/orderbook', (_req, res) => {
    const book = deps.engine.getFilteredOrderBook();
    const lastResult = deps.engine.getLastResult();

    const formatSide = (ads: any[], side: string) =>
      [...ads]
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

- [ ] **Step 2: Update the repricing router mount in `src/api/index.ts`**

In `src/api/index.ts`, change line 77 from:

```ts
  app.use('/api', createRepricingRouter({ engine: deps.repricingEngine }));
```

to:

```ts
  app.use('/api', createRepricingRouter({ engine: deps.repricingEngine, adManager: deps.adManager }));
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/api/routes/repricing.ts src/api/index.ts
git commit -m "feat: add POST /repricing/force and /force/cancel API endpoints"
```

---

### Task 5: Extend operations endpoint with manual hold state

**Files:**
- Modify: `src/api/routes/operations.ts`

- [ ] **Step 1: Add `getManualHold` to `OperationsDeps` and include in response**

In `src/api/routes/operations.ts`, update the `OperationsDeps` interface to add `getManualHold` to the `adManager` shape:

```ts
  adManager: {
    getImbalance: () => {
      sellVol: number;
      buyVol: number;
      net: number;
      threshold: number;
      pausedSide: Side | null;
    };
    getActiveAds: () => Map<Side, { side: Side; price: number; amountUsdt: number }>;
    getManualHold: () => Record<Side, { price: number; holdUntil: number } | null>;
  };
```

Then in the route handler, after the `repricing` variable, add:

```ts
    const hold = deps.adManager.getManualHold();
    const now = Date.now();
    const manualHold = {
      buy: hold.buy ? { price: hold.buy.price, holdUntil: new Date(hold.buy.holdUntil).toISOString(), remainingMs: hold.buy.holdUntil - now } : null,
      sell: hold.sell ? { price: hold.sell.price, holdUntil: new Date(hold.sell.holdUntil).toISOString(), remainingMs: hold.sell.holdUntil - now } : null,
    };
```

And add `manualHold` to the `res.json()` call:

```ts
    res.json({
      imbalance,
      ads: {
        sell: sellAd ? { price: sellAd.price, amountUsdt: sellAd.amountUsdt } : null,
        buy: buyAd ? { price: buyAd.price, amountUsdt: buyAd.amountUsdt } : null,
      },
      repricing,
      manualHold,
    });
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/api/routes/operations.ts
git commit -m "feat: include manualHold in operations endpoint response"
```

---

### Task 6: Write API tests for force reprice endpoints

**Files:**
- Create: `tests/api/repricing.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRepricingRouter } from '../../src/api/routes/repricing.js';

function createMockDeps(overrides: Record<string, any> = {}) {
  return {
    engine: {
      getConfig: vi.fn().mockReturnValue({
        mode: 'conservative',
        targetPosition: 3,
        antiOscillationThreshold: 0.003,
        minSpread: 0.015,
        maxSpread: 0.05,
        filters: { minOrderAmount: 0, verifiedOnly: false, minCompletionRate: 0, minOrderCount: 0, merchantLevels: [] },
      }),
      updateConfig: vi.fn(),
      getLastResult: vi.fn().mockReturnValue({
        action: 'reprice',
        buyPrice: 9.31,
        sellPrice: 9.35,
        spread: 0.04,
        position: { buy: 3, sell: 2 },
        filteredCompetitors: { buy: 1, sell: 2 },
        mode: 'conservative',
        reason: '',
        excludedAggressive: [],
      }),
      getFilteredOrderBook: vi.fn().mockReturnValue({ sell: [], buy: [] }),
    },
    adManager: {
      forceReprice: vi.fn().mockResolvedValue(undefined),
      clearManualHold: vi.fn(),
      getManualHold: vi.fn().mockReturnValue({ buy: null, sell: null }),
    },
    ...overrides,
  };
}

function buildApp(deps = createMockDeps()) {
  const app = express();
  app.use(express.json());
  app.use('/api', createRepricingRouter(deps));
  return { app, deps };
}

describe('Repricing API — force reprice', () => {
  it('POST /api/repricing/force with single side', async () => {
    const holdUntil = Date.now() + 240_000;
    const deps = createMockDeps({
      adManager: {
        forceReprice: vi.fn().mockResolvedValue(undefined),
        clearManualHold: vi.fn(),
        getManualHold: vi.fn().mockReturnValue({
          buy: null,
          sell: { price: 9.35, holdUntil },
        }),
      },
    });
    const { app } = buildApp(deps);

    const res = await request(app)
      .post('/api/repricing/force')
      .send({ side: 'sell', price: 9.35 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.side).toBe('sell');
    expect(res.body.price).toBe(9.35);
    expect(res.body.holdUntil).toBeTruthy();
    expect(deps.adManager.forceReprice).toHaveBeenCalledWith('sell', 9.35);
  });

  it('POST /api/repricing/force with both sides', async () => {
    const holdUntil = Date.now() + 240_000;
    const deps = createMockDeps({
      adManager: {
        forceReprice: vi.fn().mockResolvedValue(undefined),
        clearManualHold: vi.fn(),
        getManualHold: vi.fn().mockReturnValue({
          buy: { price: 9.30, holdUntil },
          sell: { price: 9.35, holdUntil },
        }),
      },
    });
    const { app } = buildApp(deps);

    const res = await request(app)
      .post('/api/repricing/force')
      .send({ buy: 9.30, sell: 9.35 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(deps.adManager.forceReprice).toHaveBeenCalledTimes(2);
  });

  it('POST /api/repricing/force rejects invalid side', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/repricing/force')
      .send({ side: 'invalid', price: 9.35 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid side');
  });

  it('POST /api/repricing/force rejects out-of-range price', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/repricing/force')
      .send({ side: 'sell', price: 50 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid price');
  });

  it('POST /api/repricing/force rejects empty body', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/repricing/force')
      .send({});

    expect(res.status).toBe(400);
  });

  it('POST /api/repricing/force/cancel clears hold', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .post('/api/repricing/force/cancel')
      .send({ side: 'sell' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.cleared).toBe('sell');
    expect(deps.adManager.clearManualHold).toHaveBeenCalledWith('sell');
  });

  it('POST /api/repricing/force/cancel with both clears both sides', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .post('/api/repricing/force/cancel')
      .send({ side: 'both' });

    expect(res.status).toBe(200);
    expect(deps.adManager.clearManualHold).toHaveBeenCalledWith('buy');
    expect(deps.adManager.clearManualHold).toHaveBeenCalledWith('sell');
  });

  it('GET /api/repricing/status includes manualHold', async () => {
    const holdUntil = Date.now() + 120_000;
    const deps = createMockDeps({
      adManager: {
        forceReprice: vi.fn(),
        clearManualHold: vi.fn(),
        getManualHold: vi.fn().mockReturnValue({
          buy: null,
          sell: { price: 9.35, holdUntil },
        }),
      },
    });
    const { app } = buildApp(deps);

    const res = await request(app).get('/api/repricing/status');
    expect(res.status).toBe(200);
    expect(res.body.manualHold.buy).toBeNull();
    expect(res.body.manualHold.sell.price).toBe(9.35);
    expect(res.body.manualHold.sell.remainingMs).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/api/repricing.test.ts`
Expected: All 7 tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/api/repricing.test.ts
git commit -m "test: add API tests for force reprice endpoints"
```

---

### Task 7: Update operations test for manualHold field

**Files:**
- Modify: `tests/api/operations.test.ts`

- [ ] **Step 1: Add `getManualHold` to mock deps and test**

In `tests/api/operations.test.ts`, add `getManualHold` to the `adManager` mock inside `createMockDeps`:

```ts
      getManualHold: vi.fn().mockReturnValue({ buy: null, sell: null }),
```

Also add `getManualHold` to the override adManager mocks in the `'returns null ads when none active'` and `'reflects imbalance paused side'` tests (anywhere `adManager` is overridden).

Then add a new test:

```ts
  it('includes manualHold in response', async () => {
    const holdUntil = Date.now() + 120_000;
    const { app } = buildApp(createMockDeps({
      adManager: {
        getImbalance: vi.fn().mockReturnValue({ sellVol: 0, buyVol: 0, net: 0, threshold: 300, pausedSide: null }),
        getActiveAds: vi.fn().mockReturnValue(new Map()),
        getManualHold: vi.fn().mockReturnValue({
          buy: null,
          sell: { price: 9.35, holdUntil },
        }),
      },
    }));
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(200);
    expect(res.body.manualHold.buy).toBeNull();
    expect(res.body.manualHold.sell.price).toBe(9.35);
  });
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/api/operations.test.ts`
Expected: All tests pass (including the new one)

- [ ] **Step 3: Commit**

```bash
git add tests/api/operations.test.ts
git commit -m "test: update operations tests for manualHold field"
```

---

### Task 8: Add dashboard API hooks

**Files:**
- Modify: `dashboard/src/hooks/useApi.ts`

- [ ] **Step 1: Extend `RepricingStatus` interface**

In `dashboard/src/hooks/useApi.ts`, add `manualHold` to the `RepricingStatus` interface:

```ts
export interface RepricingStatus {
  action: 'reprice' | 'hold' | 'pause' | 'none';
  buyPrice: number;
  sellPrice: number;
  spread: number;
  position: { buy: number; sell: number };
  filteredCompetitors: { buy: number; sell: number };
  mode: string;
  reason: string;
  excludedAggressive?: Array<{ side: string; nickName: string; price: number; gap: number }>;
  manualHold?: {
    buy: { price: number; holdUntil: string; remainingMs: number } | null;
    sell: { price: number; holdUntil: string; remainingMs: number } | null;
  };
}
```

- [ ] **Step 2: Extend `OperationsData` interface**

Add `manualHold` to `OperationsData`:

```ts
  manualHold?: {
    buy: { price: number; holdUntil: string; remainingMs: number } | null;
    sell: { price: number; holdUntil: string; remainingMs: number } | null;
  };
```

- [ ] **Step 3: Add `useForceReprice` hook**

After `useUpdateRepricingConfig`, add:

```ts
export function useForceReprice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { side: string; price: number }) => {
      const res = await fetch('/api/repricing/force', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to force reprice');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repricingStatus'] });
      queryClient.invalidateQueries({ queryKey: ['operations'] });
    },
  });
}

export function useCancelForceReprice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (side: string) => {
      const res = await fetch('/api/repricing/force/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side }),
      });
      if (!res.ok) throw new Error('Failed to cancel force reprice');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repricingStatus'] });
      queryClient.invalidateQueries({ queryKey: ['operations'] });
    },
  });
}
```

- [ ] **Step 4: Verify dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/hooks/useApi.ts
git commit -m "feat: add useForceReprice and useCancelForceReprice hooks"
```

---

### Task 9: Add Manual Reprice UI to RepricingConfig panel

**Files:**
- Modify: `dashboard/src/components/RepricingConfig.tsx`

- [ ] **Step 1: Add the Manual Reprice section**

In `dashboard/src/components/RepricingConfig.tsx`, add imports at the top:

```ts
import { useState, useEffect, useRef } from 'react';
import { useRepricingConfig, useUpdateRepricingConfig, useRepricingStatus, useForceReprice, useCancelForceReprice, type RepricingConfigData } from '../hooks/useApi';
```

(Replace the existing `useState, useEffect` import from `react` and the existing `useRepricingConfig, useUpdateRepricingConfig` import.)

Then, inside the `RepricingConfigPanel` component, after the existing hooks, add:

```ts
  const { data: status } = useRepricingStatus();
  const forceReprice = useForceReprice();
  const cancelForce = useCancelForceReprice();
  const [forceBuyPrice, setForceBuyPrice] = useState('');
  const [forceSellPrice, setForceSellPrice] = useState('');

  // Pre-fill with current prices when status loads
  useEffect(() => {
    if (status && !forceBuyPrice && status.buyPrice) setForceBuyPrice(status.buyPrice.toFixed(3));
    if (status && !forceSellPrice && status.sellPrice) setForceSellPrice(status.sellPrice.toFixed(3));
  }, [status]);
```

Add a countdown hook helper inside the component:

```ts
  // Countdown timer for manual holds
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const buyHold = status?.manualHold?.buy;
  const sellHold = status?.manualHold?.sell;
  const hasAnyHold = !!(buyHold || sellHold);

  useEffect(() => {
    if (hasAnyHold && !timerRef.current) {
      timerRef.current = setInterval(() => setNow(Date.now()), 1000);
    } else if (!hasAnyHold && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [hasAnyHold]);

  const formatCountdown = (remainingMs: number): string => {
    const adjusted = remainingMs - (Date.now() - now);
    if (adjusted <= 0) return '0:00';
    const mins = Math.floor(adjusted / 60_000);
    const secs = Math.floor((adjusted % 60_000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
```

Then, after the Competitor Filters `</div>` (the last `border border-surface-muted/30 rounded` section) and before the `update.isError` block, add:

```tsx
        {/* Manual Reprice */}
        <div className="border border-surface-muted/30 rounded px-4 py-3">
          <span className="text-sm font-medium">Manual Reprice</span>
          <div className="flex flex-col gap-2 mt-2">
            {(['buy', 'sell'] as const).map((side) => {
              const hold = side === 'buy' ? buyHold : sellHold;
              const priceVal = side === 'buy' ? forceBuyPrice : forceSellPrice;
              const setPrice = side === 'buy' ? setForceBuyPrice : setForceSellPrice;
              const isHolding = hold && hold.remainingMs > 0;

              return (
                <div key={side} className="flex items-center gap-1.5">
                  <span className={`text-xs font-semibold uppercase w-8 ${side === 'sell' ? 'text-amber-400' : 'text-blue-400'}`}>
                    {side}
                  </span>
                  <input
                    type="number"
                    step={0.001}
                    className="bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-20 font-num focus:outline-none focus:border-text-faint"
                    value={priceVal}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                  <span className="text-xs text-text-faint">BOB</span>
                  {isHolding ? (
                    <>
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-600/20 text-amber-400 font-num">
                        {formatCountdown(hold.remainingMs)}
                      </span>
                      <button
                        className="text-xs text-text-faint hover:text-red-400 transition-colors"
                        onClick={() => cancelForce.mutate(side)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="text-xs px-3 py-0.5 rounded bg-surface-muted/40 text-text-faint hover:text-text hover:bg-surface-muted transition-colors disabled:opacity-40"
                      onClick={() => {
                        const p = parseFloat(priceVal);
                        if (p && p >= 5 && p <= 15) forceReprice.mutate({ side, price: p });
                      }}
                      disabled={forceReprice.isPending}
                    >
                      Force
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {forceReprice.isError && (
            <div className="text-red-400 text-xs mt-1">Failed to force reprice.</div>
          )}
        </div>
```

- [ ] **Step 2: Verify dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/RepricingConfig.tsx
git commit -m "feat: add Manual Reprice UI section to RepricingConfig panel"
```

---

### Task 10: Add MANUAL indicator to OperationsStrip

**Files:**
- Modify: `dashboard/src/components/OperationsStrip.tsx`

- [ ] **Step 1: Update imports and add hold data**

In `dashboard/src/components/OperationsStrip.tsx`, the `useOperations` hook already returns `data` which will now include `manualHold`. After the destructuring `const { imbalance: imb, repricing: rp } = data;`, add:

```ts
  const mh = data.manualHold;
```

- [ ] **Step 2: Add MANUAL tags next to prices**

In the Buy price section (around line ~49), after the `<span className="font-num text-sm">` that shows `rp.buyPrice.toFixed(3)`, add:

```tsx
              {mh?.buy && mh.buy.remainingMs > 0 && (
                <span className="text-amber-400 text-[10px] uppercase font-semibold ml-1">MANUAL</span>
              )}
```

Similarly, in the Sell price section (around line ~53), after `rp.sellPrice.toFixed(3)`:

```tsx
              {mh?.sell && mh.sell.remainingMs > 0 && (
                <span className="text-amber-400 text-[10px] uppercase font-semibold ml-1">MANUAL</span>
              )}
```

- [ ] **Step 3: Verify dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/OperationsStrip.tsx
git commit -m "feat: show MANUAL indicator in OperationsStrip during hold"
```

---

### Task 11: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run all backend tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run full typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Run dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Final commit if any fixups needed**

If any tests or typechecks failed and you made fixes, commit them:

```bash
git add -A
git commit -m "fix: resolve test/typecheck issues from manual reprice feature"
```
