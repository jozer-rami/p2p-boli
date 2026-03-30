# Volatility Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three config-gated safety guards (gap, depth, session drift) to PriceMonitor that emit events consumed by EmergencyStop, closing volatility detection blind spots.

**Architecture:** Three new checks in PriceMonitor's `fetchOnce()` flow, each emitting a typed event. EmergencyStop subscribes to these events (existing pattern). All guards disabled by default via config. Simulator unit mode mirrors the guards for testing.

**Tech Stack:** TypeScript (ESM), existing EventBus/PriceMonitor/EmergencyStop modules, vitest.

---

## File Structure

```
Modify: src/config.ts                           — 6 new DEFAULT_CONFIG entries
Modify: src/event-bus.ts                        — 3 new events in EventMap, extend emergency trigger type
Modify: src/modules/emergency-stop/types.ts     — Extend EmergencyTrigger union
Modify: src/modules/price-monitor/index.ts      — 3 guards + PriceMonitorConfig extension
Modify: src/modules/emergency-stop/index.ts     — 3 new event subscriptions
Modify: src/index.ts                            — Read 6 new config keys, pass to PriceMonitor
Modify: src/simulator/engine.ts                 — Mirror 3 guards in unit mode, parse new config
Test:   tests/modules/price-monitor/guards.test.ts  — Tests for all 3 guards
Test:   tests/simulator/guards.test.ts          — Simulator tests with guards enabled
```

---

### Task 1: Config & Event Types

**Files:**
- Modify: `src/config.ts`
- Modify: `src/event-bus.ts`
- Modify: `src/modules/emergency-stop/types.ts`

- [ ] **Step 1: Add 6 new config keys to DEFAULT_CONFIG**

In `src/config.ts`, add after the `qr_pre_message` entry (line 59):

```typescript
  gap_guard_enabled: 'false',
  gap_guard_threshold_percent: '2',
  depth_guard_enabled: 'false',
  depth_guard_min_usdt: '100',
  session_drift_guard_enabled: 'false',
  session_drift_threshold_percent: '3',
```

- [ ] **Step 2: Add 3 new events to EventMap**

In `src/event-bus.ts`, add after the `'price:stale'` entry (after line 27):

```typescript
  'price:gap-alert': {
    lastKnownPrice: number;
    resumePrice: number;
    changePercent: number;
    gapDurationSeconds: number;
  };
  'price:low-depth': {
    totalAsk: number;
    totalBid: number;
    minRequired: number;
  };
  'price:session-drift': {
    sessionBasePrice: number;
    currentPrice: number;
    driftPercent: number;
  };
```

- [ ] **Step 3: Extend EmergencyTrigger type**

In `src/modules/emergency-stop/types.ts`, replace line 1:

```typescript
export type EmergencyTrigger = 'volatility' | 'spread_inversion' | 'stale_data' | 'manual' | 'gap_alert' | 'low_depth' | 'session_drift';
```

- [ ] **Step 4: Extend emergency:triggered event trigger union**

In `src/event-bus.ts`, update the `'emergency:triggered'` event's `trigger` field (line 48):

```typescript
    trigger: 'volatility' | 'spread_inversion' | 'stale_data' | 'manual' | 'gap_alert' | 'low_depth' | 'session_drift';
```

- [ ] **Step 5: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Clean (0 errors)

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/event-bus.ts src/modules/emergency-stop/types.ts
git commit -m "feat(guards): add config keys, event types, and trigger types for volatility guards"
```

---

### Task 2: PriceMonitor Guards

**Files:**
- Modify: `src/modules/price-monitor/index.ts`
- Test: `tests/modules/price-monitor/guards.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/modules/price-monitor/guards.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceMonitor } from '../../../src/modules/price-monitor/index.js';
import { EventBus } from '../../../src/event-bus.js';
import { createTestDB } from '../../../src/db/index.js';
import type { DB } from '../../../src/db/index.js';

type MockClient = {
  getUsdtBobPrices: ReturnType<typeof vi.fn>;
  getFees: ReturnType<typeof vi.fn>;
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

afterEach(() => close());

function makePrices(ask: number, bid: number, totalAsk = 500, totalBid = 400) {
  return [{ platform: 'bybitp2p', ask, bid, totalAsk, totalBid, time: Math.floor(Date.now() / 1000) }];
}

describe('Gap Guard', () => {
  it('emits price:gap-alert when price jumps after a gap exceeding the volatility window', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      gapGuardEnabled: true,
      gapGuardThresholdPercent: 2,
    });

    const gapHandler = vi.fn();
    bus.on('price:gap-alert', gapHandler);

    // First fetch: establish baseline at bid=6.890
    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();
    expect(gapHandler).not.toHaveBeenCalled();

    // Simulate time passing beyond the volatility window (6 minutes)
    // We do this by directly manipulating the internal state via a second fetch
    // after advancing time. We'll use vi.spyOn(Date, 'now') to jump forward.
    const baseTime = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 6 * 60 * 1000);

    // Second fetch: price jumped 5.5% after the gap
    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.30, 7.27));
    await monitor.fetchOnce();

    expect(gapHandler).toHaveBeenCalledTimes(1);
    expect(gapHandler).toHaveBeenCalledWith(expect.objectContaining({
      lastKnownPrice: 6.89,
      resumePrice: 7.27,
    }));
    expect(gapHandler.mock.calls[0][0].changePercent).toBeGreaterThan(5);

    vi.restoreAllMocks();
  });

  it('does not emit gap alert when gap is within volatility window', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      gapGuardEnabled: true,
      gapGuardThresholdPercent: 2,
    });

    const gapHandler = vi.fn();
    bus.on('price:gap-alert', gapHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();

    // Only 2 minutes later — within the window
    const baseTime = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 2 * 60 * 1000);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.30, 7.27));
    await monitor.fetchOnce();

    // No gap alert — the rolling window check handles this case
    expect(gapHandler).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('does not emit gap alert when disabled', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      gapGuardEnabled: false,
      gapGuardThresholdPercent: 2,
    });

    const gapHandler = vi.fn();
    bus.on('price:gap-alert', gapHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();

    const baseTime = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 6 * 60 * 1000);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.30, 7.27));
    await monitor.fetchOnce();

    expect(gapHandler).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('Depth Guard', () => {
  it('emits price:low-depth when totalAsk is below minimum', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      depthGuardEnabled: true,
      depthGuardMinUsdt: 100,
    });

    const depthHandler = vi.fn();
    bus.on('price:low-depth', depthHandler);

    // totalAsk=50 is below min 100
    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89, 50, 400));
    await monitor.fetchOnce();

    expect(depthHandler).toHaveBeenCalledTimes(1);
    expect(depthHandler).toHaveBeenCalledWith(expect.objectContaining({
      totalAsk: 50,
      totalBid: 400,
      minRequired: 100,
    }));
  });

  it('emits price:low-depth when totalBid is below minimum', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      depthGuardEnabled: true,
      depthGuardMinUsdt: 100,
    });

    const depthHandler = vi.fn();
    bus.on('price:low-depth', depthHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89, 500, 30));
    await monitor.fetchOnce();

    expect(depthHandler).toHaveBeenCalledTimes(1);
  });

  it('does not emit when depth is sufficient', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      depthGuardEnabled: true,
      depthGuardMinUsdt: 100,
    });

    const depthHandler = vi.fn();
    bus.on('price:low-depth', depthHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89, 500, 400));
    await monitor.fetchOnce();

    expect(depthHandler).not.toHaveBeenCalled();
  });

  it('does not emit when disabled', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      depthGuardEnabled: false,
      depthGuardMinUsdt: 100,
    });

    const depthHandler = vi.fn();
    bus.on('price:low-depth', depthHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89, 50, 30));
    await monitor.fetchOnce();

    expect(depthHandler).not.toHaveBeenCalled();
  });
});

describe('Session Drift Guard', () => {
  it('emits price:session-drift when price drifts beyond threshold', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      sessionDriftGuardEnabled: true,
      sessionDriftThresholdPercent: 3,
    });

    const driftHandler = vi.fn();
    bus.on('price:session-drift', driftHandler);

    // First fetch: sets session base price
    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();
    expect(driftHandler).not.toHaveBeenCalled();

    // Second fetch: 4% drift — exceeds 3% threshold
    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.20, 7.17));
    await monitor.fetchOnce();

    expect(driftHandler).toHaveBeenCalledTimes(1);
    expect(driftHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionBasePrice: 6.89,
      currentPrice: 7.17,
    }));
    expect(driftHandler.mock.calls[0][0].driftPercent).toBeGreaterThan(3);
  });

  it('does not emit when drift is within threshold', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      sessionDriftGuardEnabled: true,
      sessionDriftThresholdPercent: 3,
    });

    const driftHandler = vi.fn();
    bus.on('price:session-drift', driftHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();

    // 1% drift — under threshold
    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.99, 6.96));
    await monitor.fetchOnce();

    expect(driftHandler).not.toHaveBeenCalled();
  });

  it('resets session base price on emergency:resolved', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      sessionDriftGuardEnabled: true,
      sessionDriftThresholdPercent: 3,
    });

    const driftHandler = vi.fn();
    bus.on('price:session-drift', driftHandler);

    // Establish base
    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();

    // Simulate emergency resolve — resets session base
    await bus.emit('emergency:resolved', { resumedBy: 'test' }, 'test');

    // Next fetch at higher price — should set new base, not alert
    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.20, 7.17));
    await monitor.fetchOnce();

    expect(driftHandler).not.toHaveBeenCalled();

    // Now drift 4% from the new base (7.17)
    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.50, 7.46));
    await monitor.fetchOnce();

    expect(driftHandler).toHaveBeenCalledTimes(1);
    expect(driftHandler.mock.calls[0][0].sessionBasePrice).toBeCloseTo(7.17, 1);
  });

  it('does not emit when disabled', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      sessionDriftGuardEnabled: false,
      sessionDriftThresholdPercent: 3,
    });

    const driftHandler = vi.fn();
    bus.on('price:session-drift', driftHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.20, 7.17));
    await monitor.fetchOnce();

    expect(driftHandler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/modules/price-monitor/guards.test.ts`
Expected: FAIL — PriceMonitorConfig doesn't have the new fields, guards don't exist

- [ ] **Step 3: Extend PriceMonitorConfig**

In `src/modules/price-monitor/index.ts`, replace the config interface (lines 13-16):

```typescript
export interface PriceMonitorConfig {
  volatilityThresholdPercent: number;
  volatilityWindowMinutes: number;
  gapGuardEnabled?: boolean;
  gapGuardThresholdPercent?: number;
  depthGuardEnabled?: boolean;
  depthGuardMinUsdt?: number;
  sessionDriftGuardEnabled?: boolean;
  sessionDriftThresholdPercent?: number;
}
```

- [ ] **Step 4: Add guard state and emergency:resolved listener**

In `src/modules/price-monitor/index.ts`, add three new private fields after `private intervalHandle` (line 34):

```typescript
  private lastKnownPrice: number | null = null;
  private lastSuccessfulFetch = 0;
  private sessionBasePrice: number | null = null;
```

At the end of the constructor (after line 47, before the closing `}`), add:

```typescript
    // Reset session base price when emergency is resolved
    this.bus.on('emergency:resolved', () => {
      this.sessionBasePrice = null;
      log.info('Session base price reset (emergency resolved)');
    });
```

- [ ] **Step 5: Add gap guard check**

In `src/modules/price-monitor/index.ts`, add a new private method after `checkVolatility`:

```typescript
  private async checkGapGuard(currentBid: number, now: number): Promise<void> {
    if (!this.config.gapGuardEnabled) return;

    const threshold = this.config.gapGuardThresholdPercent ?? 2;
    const windowMs = this.config.volatilityWindowMinutes * 60 * 1000;

    if (this.lastKnownPrice !== null && this.lastSuccessfulFetch > 0) {
      const gapMs = now - this.lastSuccessfulFetch;
      if (gapMs > windowMs) {
        const changePercent = Math.abs((currentBid - this.lastKnownPrice) / this.lastKnownPrice) * 100;
        if (changePercent > threshold) {
          await this.bus.emit('price:gap-alert', {
            lastKnownPrice: this.lastKnownPrice,
            resumePrice: currentBid,
            changePercent,
            gapDurationSeconds: Math.floor(gapMs / 1000),
          }, MODULE);
          log.warn({ lastKnownPrice: this.lastKnownPrice, resumePrice: currentBid, changePercent }, 'Gap guard alert');
        }
      }
    }

    this.lastKnownPrice = currentBid;
    this.lastSuccessfulFetch = now;
  }
```

- [ ] **Step 6: Add depth guard check**

Add another private method:

```typescript
  private async checkDepthGuard(prices: import('../../event-bus.js').PlatformPrices[]): Promise<void> {
    if (!this.config.depthGuardEnabled) return;

    const minUsdt = this.config.depthGuardMinUsdt ?? 100;
    const bybit = prices.find((p) => p.platform.startsWith('bybit'));
    if (!bybit) return;

    if (bybit.totalAsk < minUsdt || bybit.totalBid < minUsdt) {
      await this.bus.emit('price:low-depth', {
        totalAsk: bybit.totalAsk,
        totalBid: bybit.totalBid,
        minRequired: minUsdt,
      }, MODULE);
      log.warn({ totalAsk: bybit.totalAsk, totalBid: bybit.totalBid, minUsdt }, 'Low depth alert');
    }
  }
```

- [ ] **Step 7: Add session drift guard check**

Add another private method:

```typescript
  private async checkSessionDrift(currentBid: number): Promise<void> {
    if (!this.config.sessionDriftGuardEnabled) return;

    const threshold = this.config.sessionDriftThresholdPercent ?? 3;

    if (this.sessionBasePrice === null) {
      this.sessionBasePrice = currentBid;
      log.info({ sessionBasePrice: currentBid }, 'Session base price set');
      return;
    }

    const driftPercent = Math.abs((currentBid - this.sessionBasePrice) / this.sessionBasePrice) * 100;
    if (driftPercent > threshold) {
      await this.bus.emit('price:session-drift', {
        sessionBasePrice: this.sessionBasePrice,
        currentPrice: currentBid,
        driftPercent,
      }, MODULE);
      log.warn({ sessionBasePrice: this.sessionBasePrice, currentPrice: currentBid, driftPercent }, 'Session drift alert');
    }
  }
```

- [ ] **Step 8: Wire guards into fetchOnce()**

In `fetchOnce()`, after the volatility check (after line 117 `}`), add:

```typescript
      // Guards
      if (refPrice !== undefined) {
        await this.checkGapGuard(refPrice, now);
        await this.checkSessionDrift(refPrice);
      }
      await this.checkDepthGuard(this.latestPrices);
```

And remove the duplicate `lastKnownPrice`/`lastSuccessfulFetch` updates from fetchOnce since `checkGapGuard` handles them. Make sure the existing `this.lastUpdateTime = now;` on line 106 stays — that's used for the stale check, which is different from `lastSuccessfulFetch`.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/modules/price-monitor/guards.test.ts`
Expected: PASS — all 11 tests green

- [ ] **Step 10: Run existing price-monitor tests to verify no regressions**

Run: `npx vitest run tests/modules/price-monitor/`
Expected: All tests pass

- [ ] **Step 11: Commit**

```bash
git add src/modules/price-monitor/index.ts tests/modules/price-monitor/guards.test.ts
git commit -m "feat(guards): implement gap, depth, and session drift guards in PriceMonitor"
```

---

### Task 3: EmergencyStop Subscriptions

**Files:**
- Modify: `src/modules/emergency-stop/index.ts`
- Test: `tests/modules/emergency-stop/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the existing test file `tests/modules/emergency-stop/index.test.ts`. Read the file first to understand the existing test structure, then add these tests inside the existing `describe` block:

```typescript
  it('triggers on price:gap-alert', async () => {
    await bus.emit('price:gap-alert', {
      lastKnownPrice: 6.89,
      resumePrice: 7.27,
      changePercent: 5.5,
      gapDurationSeconds: 360,
    }, 'test');

    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalled();
    expect(deps.stopPolling).toHaveBeenCalled();
  });

  it('triggers on price:low-depth', async () => {
    await bus.emit('price:low-depth', {
      totalAsk: 50,
      totalBid: 30,
      minRequired: 100,
    }, 'test');

    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalled();
  });

  it('triggers on price:session-drift', async () => {
    await bus.emit('price:session-drift', {
      sessionBasePrice: 6.89,
      currentPrice: 7.17,
      driftPercent: 4.1,
    }, 'test');

    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/modules/emergency-stop/index.test.ts`
Expected: FAIL — EmergencyStop doesn't subscribe to the new events

- [ ] **Step 3: Add subscriptions to EmergencyStop constructor**

In `src/modules/emergency-stop/index.ts`, add after the `telegram:emergency` listener (after line 44):

```typescript
    this.bus.on('price:gap-alert', (payload) => {
      return this.trigger('gap_alert', `Price jumped ${payload.changePercent.toFixed(1)}% after ${payload.gapDurationSeconds}s data gap`);
    });

    this.bus.on('price:low-depth', (payload) => {
      return this.trigger('low_depth', `Order book depth ${Math.min(payload.totalAsk, payload.totalBid)} USDT below minimum ${payload.minRequired}`);
    });

    this.bus.on('price:session-drift', (payload) => {
      return this.trigger('session_drift', `Price drifted ${payload.driftPercent.toFixed(1)}% from session start`);
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/modules/emergency-stop/index.test.ts`
Expected: All tests pass (existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add src/modules/emergency-stop/index.ts tests/modules/emergency-stop/index.test.ts
git commit -m "feat(guards): add EmergencyStop subscriptions for gap, depth, and session drift events"
```

---

### Task 4: Wiring in src/index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Read and pass new config keys to PriceMonitor**

In `src/index.ts`, after the existing config reads (after line 93 `const qrPreMessage = ...`), add:

```typescript
const gapGuardEnabled = (await getConfig('gap_guard_enabled')) === 'true';
const gapGuardThresholdPercent = parseFloat(await getConfig('gap_guard_threshold_percent'));
const depthGuardEnabled = (await getConfig('depth_guard_enabled')) === 'true';
const depthGuardMinUsdt = parseFloat(await getConfig('depth_guard_min_usdt'));
const sessionDriftGuardEnabled = (await getConfig('session_drift_guard_enabled')) === 'true';
const sessionDriftThresholdPercent = parseFloat(await getConfig('session_drift_threshold_percent'));
```

Then update the PriceMonitor construction (lines 101-104) to pass the new config:

```typescript
const priceMonitor = new PriceMonitor(bus, db, criptoYaClient, {
  volatilityThresholdPercent,
  volatilityWindowMinutes,
  gapGuardEnabled,
  gapGuardThresholdPercent,
  depthGuardEnabled,
  depthGuardMinUsdt,
  sessionDriftGuardEnabled,
  sessionDriftThresholdPercent,
}, bybitClient);
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(guards): wire guard config from DB to PriceMonitor"
```

---

### Task 5: Simulator Unit Mode Guards

**Files:**
- Modify: `src/simulator/engine.ts`
- Test: `tests/simulator/guards.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/simulator/guards.test.ts
import { describe, it, expect } from 'vitest';
import { runUnit } from '../../src/simulator/engine.js';
import type { Scenario } from '../../src/simulator/types.js';

const pricingConfig = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };

describe('simulator guards in unit mode', () => {
  it('gap guard triggers emergency after data gap with price jump', () => {
    const volatilityConfig = {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      gapGuardEnabled: true,
      gapGuardThresholdPercent: 2,
    };

    const scenario: Scenario = {
      name: 'test-gap',
      description: 'Gap bypass test',
      tickIntervalMs: 30_000,
      ticks: [
        // 5 normal ticks
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        // 12 stale ticks (6 min gap — exceeds 5 min window)
        ...Array.from({ length: 12 }, () => ({ ask: 0, bid: 0, totalAsk: 0, totalBid: 0 })),
        // Resume with 5.5% jump
        { ask: 7.30, bid: 7.27, totalAsk: 200, totalBid: 150 },
      ],
    };

    const result = runUnit(scenario, pricingConfig, volatilityConfig);

    // The gap guard should catch the jump that the rolling window missed
    const gapEvents = result.timeline.filter((t) =>
      t.events.some((e) => e.includes('gap-alert')),
    );
    expect(gapEvents.length).toBeGreaterThan(0);
    expect(result.summary.emergencyTriggered).toBe(true);
  });

  it('depth guard triggers emergency on thin book', () => {
    const volatilityConfig = {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      depthGuardEnabled: true,
      depthGuardMinUsdt: 100,
    };

    const scenario: Scenario = {
      name: 'test-depth',
      description: 'Thin book test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 50, totalBid: 40 }, // thin
      ],
    };

    const result = runUnit(scenario, pricingConfig, volatilityConfig);

    const depthEvents = result.timeline.filter((t) =>
      t.events.some((e) => e.includes('low-depth')),
    );
    expect(depthEvents.length).toBeGreaterThan(0);
    expect(result.summary.emergencyTriggered).toBe(true);
  });

  it('session drift guard triggers emergency on gradual drift', () => {
    const volatilityConfig = {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      sessionDriftGuardEnabled: true,
      sessionDriftThresholdPercent: 3,
    };

    // Staircase: 5 steps of ~0.8% with gaps — total 4%
    const scenario: Scenario = {
      name: 'test-drift',
      description: 'Staircase evasion test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        // gap
        ...Array.from({ length: 4 }, () => ({ ask: 0, bid: 0, totalAsk: 0, totalBid: 0 })),
        // +0.8%
        { ask: 6.975, bid: 6.945, totalAsk: 500, totalBid: 400 },
        { ask: 6.975, bid: 6.945, totalAsk: 500, totalBid: 400 },
        // gap
        ...Array.from({ length: 4 }, () => ({ ask: 0, bid: 0, totalAsk: 0, totalBid: 0 })),
        // +0.8%
        { ask: 7.031, bid: 7.001, totalAsk: 500, totalBid: 400 },
        { ask: 7.031, bid: 7.001, totalAsk: 500, totalBid: 400 },
        // gap
        ...Array.from({ length: 4 }, () => ({ ask: 0, bid: 0, totalAsk: 0, totalBid: 0 })),
        // +0.8%
        { ask: 7.087, bid: 7.057, totalAsk: 500, totalBid: 400 },
        { ask: 7.087, bid: 7.057, totalAsk: 500, totalBid: 400 },
        // gap
        ...Array.from({ length: 4 }, () => ({ ask: 0, bid: 0, totalAsk: 0, totalBid: 0 })),
        // +0.8% — total ~3.3% drift from 6.89
        { ask: 7.144, bid: 7.114, totalAsk: 500, totalBid: 400 },
      ],
    };

    const result = runUnit(scenario, pricingConfig, volatilityConfig);

    const driftEvents = result.timeline.filter((t) =>
      t.events.some((e) => e.includes('session-drift')),
    );
    expect(driftEvents.length).toBeGreaterThan(0);
    expect(result.summary.emergencyTriggered).toBe(true);
  });

  it('guards do not trigger when disabled (default)', () => {
    const volatilityConfig = {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      // All guards off (default)
    };

    const scenario: Scenario = {
      name: 'test-disabled',
      description: 'Guards off test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 5, totalBid: 5 },
      ],
    };

    const result = runUnit(scenario, pricingConfig, volatilityConfig);

    // No guard events — only normal pricing events
    const guardEvents = result.timeline.filter((t) =>
      t.events.some((e) => e.includes('gap-alert') || e.includes('low-depth') || e.includes('session-drift')),
    );
    expect(guardEvents.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/simulator/guards.test.ts`
Expected: FAIL — VolatilityConfig doesn't have guard fields, engine doesn't check guards

- [ ] **Step 3: Extend VolatilityConfig in engine.ts**

In `src/simulator/engine.ts`, update the `VolatilityConfig` interface:

```typescript
export interface VolatilityConfig {
  volatilityThresholdPercent: number;
  volatilityWindowMinutes: number;
  gapGuardEnabled?: boolean;
  gapGuardThresholdPercent?: number;
  depthGuardEnabled?: boolean;
  depthGuardMinUsdt?: number;
  sessionDriftGuardEnabled?: boolean;
  sessionDriftThresholdPercent?: number;
}
```

- [ ] **Step 4: Add guard state and checks to runUnit()**

In `src/simulator/engine.ts`, inside `runUnit()`, after the existing state declarations (`let inEmergency = false;`), add:

```typescript
  let lastKnownPrice: number | null = null;
  let lastValidTickTime = 0;
  let sessionBasePrice: number | null = null;
```

Then inside the tick loop, after the volatility check block (after the `if (vol.alert)` block) and before the `timeline.push` call, add the three guard checks:

```typescript
    // Gap guard
    if (volatilityConfig.gapGuardEnabled && tick.bid > 0) {
      const windowMs = volatilityConfig.volatilityWindowMinutes * 60 * 1000;
      if (lastKnownPrice !== null && lastValidTickTime > 0) {
        const gapMs = clock.now() - lastValidTickTime;
        if (gapMs > windowMs) {
          const gapChange = Math.abs((tick.bid - lastKnownPrice) / lastKnownPrice) * 100;
          const gapThreshold = volatilityConfig.gapGuardThresholdPercent ?? 2;
          if (gapChange > gapThreshold) {
            events.push(`gap-alert(${gapChange.toFixed(1)}%,${Math.floor(gapMs / 1000)}s)`);
            events.push(`emergency:triggered(gap_alert)`);
            inEmergency = true;
          }
        }
      }
      lastKnownPrice = tick.bid;
      lastValidTickTime = clock.now();
    }

    // Depth guard
    if (volatilityConfig.depthGuardEnabled && tick.ask > 0 && tick.bid > 0) {
      const minUsdt = volatilityConfig.depthGuardMinUsdt ?? 100;
      if (tick.totalAsk < minUsdt || tick.totalBid < minUsdt) {
        events.push(`low-depth(ask:${tick.totalAsk},bid:${tick.totalBid},min:${minUsdt})`);
        events.push(`emergency:triggered(low_depth)`);
        inEmergency = true;
      }
    }

    // Session drift guard
    if (volatilityConfig.sessionDriftGuardEnabled && tick.bid > 0) {
      if (sessionBasePrice === null) {
        sessionBasePrice = tick.bid;
      } else {
        const drift = Math.abs((tick.bid - sessionBasePrice) / sessionBasePrice) * 100;
        const driftThreshold = volatilityConfig.sessionDriftThresholdPercent ?? 3;
        if (drift > driftThreshold) {
          events.push(`session-drift(${drift.toFixed(1)}%,base:${sessionBasePrice.toFixed(3)})`);
          events.push(`emergency:triggered(session_drift)`);
          inEmergency = true;
        }
      }
    }
```

- [ ] **Step 5: Update CLI config parsing**

In `src/simulator/index.ts`, update the `volatilityConfig` object construction to also read guard configs from `--config` overrides:

```typescript
  const volatilityConfig = {
    volatilityThresholdPercent: parseFloat(args.configOverrides.volatility_threshold_percent ?? '2'),
    volatilityWindowMinutes: parseFloat(args.configOverrides.volatility_window_minutes ?? '5'),
    gapGuardEnabled: args.configOverrides.gap_guard_enabled === 'true',
    gapGuardThresholdPercent: parseFloat(args.configOverrides.gap_guard_threshold_percent ?? '2'),
    depthGuardEnabled: args.configOverrides.depth_guard_enabled === 'true',
    depthGuardMinUsdt: parseFloat(args.configOverrides.depth_guard_min_usdt ?? '100'),
    sessionDriftGuardEnabled: args.configOverrides.session_drift_guard_enabled === 'true',
    sessionDriftThresholdPercent: parseFloat(args.configOverrides.session_drift_threshold_percent ?? '3'),
  };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/simulator/guards.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 7: Run full simulator test suite**

Run: `npx vitest run tests/simulator/`
Expected: All tests pass (existing + new)

- [ ] **Step 8: Commit**

```bash
git add src/simulator/engine.ts src/simulator/index.ts tests/simulator/guards.test.ts
git commit -m "feat(guards): mirror gap, depth, and session drift guards in simulator unit mode"
```

---

### Task 6: End-to-End Verification

**Files:** No new files. Verify everything works.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (1 pre-existing failure in orders API is acceptable)

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Verify staircase evasion is now caught with session drift guard**

Run: `LOG_LEVEL=silent npm run simulate -- --scenario repeated-micro-gaps --mode unit --config session_drift_guard_enabled=true,session_drift_threshold_percent=3`
Expected: Emergency triggered, session-drift event visible in timeline

- [ ] **Step 4: Verify gap bypass is now caught with gap guard**

Run: `LOG_LEVEL=silent npm run simulate -- --scenario stale-then-spike --mode unit --config gap_guard_enabled=true,gap_guard_threshold_percent=2`
Expected: Emergency triggered on the tick after the 6-min gap

- [ ] **Step 5: Verify thin book is now caught with depth guard**

Run: `LOG_LEVEL=silent npm run simulate -- --scenario thin-book-crash --mode unit --config depth_guard_enabled=true,depth_guard_min_usdt=100`
Expected: Emergency triggered when depth drops below 100

- [ ] **Step 6: Verify guards don't fire when disabled (default behavior unchanged)**

Run: `LOG_LEVEL=silent npm run simulate -- --scenario repeated-micro-gaps --mode unit`
Expected: No emergency — same behavior as before (guards off by default)

- [ ] **Step 7: Commit if any adjustments were needed**

```bash
git add -A
git commit -m "chore(guards): final verification and cleanup"
```
