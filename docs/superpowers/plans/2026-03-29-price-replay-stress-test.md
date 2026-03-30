# Price Replay & Stress Test Simulator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone CLI tool (`npm run simulate`) that replays historical or synthetic price sequences through the bot's pricing and trading logic, producing decision timelines and pass/fail assertions.

**Architecture:** Two-mode simulation engine. Unit mode feeds ticks directly into `calculatePricing()` + volatility detection. Integration mode wires real modules (PriceMonitor, AdManager, EmergencyStop) with mock externals through existing dependency injection interfaces. A `SimulatedClock` ensures deterministic, reproducible results.

**Tech Stack:** TypeScript (ESM), existing project modules, in-memory SQLite for integration mode, no new dependencies needed.

---

## File Structure

```
src/simulator/
  types.ts              # Scenario, Tick, Assertion, TimelineEntry, SimulatedClock types
  clock.ts              # SimulatedClock implementation
  engine.ts             # runUnit() and runIntegration() functions
  index.ts              # CLI entry point, arg parsing, output routing
  mocks/
    replay-price-source.ts   # CriptoYaClient-compatible mock that feeds scenario ticks
    mock-bybit-client.ts     # BybitClient-compatible mock that tracks ad state in memory
  scenarios/
    generators.ts            # linearDrop, linearRecover, oscillate, spreadSqueeze, stale helpers
    index.ts                 # Scenario registry + defineScenario helper
    flash-crash-5pct.ts      # Built-in scenario
    flash-crash-10pct.ts     # Built-in scenario
    spread-squeeze.ts        # Built-in scenario
    spread-inversion.ts      # Built-in scenario
    oscillation.ts           # Built-in scenario
    slow-drift.ts            # Built-in scenario
    stale-then-spike.ts      # Built-in scenario
    thin-book.ts             # Built-in scenario
  output/
    table.ts                 # Timeline table formatter (stdout)
    json.ts                  # JSON output formatter
    assertions.ts            # Assertion runner + reporter
```

---

### Task 1: Types & SimulatedClock

**Files:**
- Create: `src/simulator/types.ts`
- Create: `src/simulator/clock.ts`
- Test: `tests/simulator/clock.test.ts`

- [ ] **Step 1: Write the failing test for SimulatedClock**

```typescript
// tests/simulator/clock.test.ts
import { describe, it, expect } from 'vitest';
import { SimulatedClock } from '../../src/simulator/clock.js';

describe('SimulatedClock', () => {
  it('starts at the given origin time', () => {
    const clock = new SimulatedClock(1000);
    expect(clock.now()).toBe(1000);
  });

  it('advances by tickIntervalMs on each tick', () => {
    const clock = new SimulatedClock(0);
    clock.advance(30_000);
    expect(clock.now()).toBe(30_000);
    clock.advance(30_000);
    expect(clock.now()).toBe(60_000);
  });

  it('tracks tick count', () => {
    const clock = new SimulatedClock(0);
    expect(clock.tickCount).toBe(0);
    clock.advance(30_000);
    expect(clock.tickCount).toBe(1);
    clock.advance(30_000);
    expect(clock.tickCount).toBe(2);
  });

  it('formats elapsed time as HH:MM:SS', () => {
    const clock = new SimulatedClock(0);
    expect(clock.elapsed()).toBe('00:00:00');
    clock.advance(90_000); // 1m30s
    expect(clock.elapsed()).toBe('00:01:30');
    clock.advance(3510_000); // +58m30s = 60m total
    expect(clock.elapsed()).toBe('01:00:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/simulator/clock.test.ts`
Expected: FAIL — cannot resolve `../../src/simulator/clock.js`

- [ ] **Step 3: Create types.ts**

```typescript
// src/simulator/types.ts

import type { PlatformPrices } from '../event-bus.js';

/** A single price snapshot in a scenario */
export interface ScenarioTick {
  ask: number;
  bid: number;
  totalAsk: number;
  totalBid: number;
}

/** Assertion expectations for a scenario run */
export interface ScenarioExpectations {
  emergencyTriggered?: boolean;
  emergencyByTick?: number;
  maxRepricesBeforeEmergency?: number;
  noAdsActiveDuring?: [number, number];
  spreadNeverBelow?: number;
}

/** Full scenario definition */
export interface Scenario {
  name: string;
  description: string;
  source?: string;
  tickIntervalMs: number;
  ticks: ScenarioTick[];
  expect?: ScenarioExpectations;
}

/** A single entry in the simulation timeline */
export interface TimelineEntry {
  tick: number;
  elapsed: string;
  ask: number;
  bid: number;
  marketSpread: number;
  buyPrice: number | null;
  sellPrice: number | null;
  botSpread: number | null;
  events: string[];
  paused: boolean;
  pauseReason?: string;
}

/** Full simulation result */
export interface SimulationResult {
  scenario: string;
  mode: 'unit' | 'integration';
  timeline: TimelineEntry[];
  summary: SimulationSummary;
}

export interface SimulationSummary {
  totalTicks: number;
  simulatedDuration: string;
  repriceCount: number;
  pauseCount: number;
  emergencyTriggered: boolean;
  emergencyAtTick: number | null;
  emergencyReason: string | null;
  maxSpread: number;
  minSpread: number;
}

/** Convert a ScenarioTick to PlatformPrices for module consumption */
export function tickToPlatformPrices(tick: ScenarioTick, timeMs: number): PlatformPrices {
  return {
    platform: 'bybitp2p',
    ask: tick.ask,
    totalAsk: tick.totalAsk,
    bid: tick.bid,
    totalBid: tick.totalBid,
    time: Math.floor(timeMs / 1000),
  };
}
```

- [ ] **Step 4: Create clock.ts**

```typescript
// src/simulator/clock.ts

export class SimulatedClock {
  private currentMs: number;
  private readonly originMs: number;
  private _tickCount = 0;

  constructor(originMs: number = Date.now()) {
    this.originMs = originMs;
    this.currentMs = originMs;
  }

  now(): number {
    return this.currentMs;
  }

  get tickCount(): number {
    return this._tickCount;
  }

  advance(ms: number): void {
    this.currentMs += ms;
    this._tickCount++;
  }

  elapsed(): string {
    const totalSeconds = Math.floor((this.currentMs - this.originMs) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/simulator/clock.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 6: Commit**

```bash
git add src/simulator/types.ts src/simulator/clock.ts tests/simulator/clock.test.ts
git commit -m "feat(simulator): add types and SimulatedClock"
```

---

### Task 2: Scenario Generators

**Files:**
- Create: `src/simulator/scenarios/generators.ts`
- Create: `src/simulator/scenarios/index.ts`
- Test: `tests/simulator/generators.test.ts`

- [ ] **Step 1: Write the failing tests for generators**

```typescript
// tests/simulator/generators.test.ts
import { describe, it, expect } from 'vitest';
import {
  linearDrop,
  linearRecover,
  oscillate,
  spreadSqueeze,
  stale,
} from '../../src/simulator/scenarios/generators.js';
import type { ScenarioTick } from '../../src/simulator/types.js';

describe('linearDrop', () => {
  it('generates linearly decreasing prices over N ticks', () => {
    const ticks = linearDrop({
      from: { ask: 10.0, bid: 9.9 },
      to: { ask: 9.0, bid: 8.9 },
      ticks: 5,
    });

    expect(ticks).toHaveLength(5);
    expect(ticks[0].ask).toBeCloseTo(10.0);
    expect(ticks[0].bid).toBeCloseTo(9.9);
    expect(ticks[4].ask).toBeCloseTo(9.0);
    expect(ticks[4].bid).toBeCloseTo(8.9);
    // Monotonically decreasing
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].ask).toBeLessThan(ticks[i - 1].ask);
    }
  });

  it('defaults totalAsk/totalBid to 500', () => {
    const ticks = linearDrop({
      from: { ask: 10.0, bid: 9.9 },
      to: { ask: 9.0, bid: 8.9 },
      ticks: 2,
    });
    expect(ticks[0].totalAsk).toBe(500);
    expect(ticks[0].totalBid).toBe(500);
  });
});

describe('linearRecover', () => {
  it('generates linearly increasing prices over N ticks', () => {
    const ticks = linearRecover({
      from: { ask: 9.0, bid: 8.9 },
      to: { ask: 10.0, bid: 9.9 },
      ticks: 5,
    });

    expect(ticks).toHaveLength(5);
    expect(ticks[0].ask).toBeCloseTo(9.0);
    expect(ticks[4].ask).toBeCloseTo(10.0);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].ask).toBeGreaterThan(ticks[i - 1].ask);
    }
  });
});

describe('oscillate', () => {
  it('generates sinusoidal price swings', () => {
    const ticks = oscillate({
      center: { ask: 10.0, bid: 9.9 },
      amplitude: 0.5,
      period: 4,
      ticks: 8,
    });

    expect(ticks).toHaveLength(8);
    // At tick 0: sin(0) = 0, so price = center
    expect(ticks[0].ask).toBeCloseTo(10.0);
    // At tick 1 (period=4): sin(2*PI*1/4) = sin(PI/2) = 1, so ask = 10.0 + 0.5
    expect(ticks[1].ask).toBeCloseTo(10.5);
    // At tick 2: sin(PI) = 0
    expect(ticks[2].ask).toBeCloseTo(10.0);
    // Full cycle repeats
    expect(ticks[4].ask).toBeCloseTo(10.0);
  });
});

describe('spreadSqueeze', () => {
  it('converges ask and bid toward each other', () => {
    const ticks = spreadSqueeze({
      start: { ask: 10.0, bid: 9.8 },
      endSpread: 0.01,
      ticks: 5,
    });

    expect(ticks).toHaveLength(5);
    // Starting spread = 0.20
    expect(ticks[0].ask - ticks[0].bid).toBeCloseTo(0.2);
    // Ending spread = 0.01
    expect(ticks[4].ask - ticks[4].bid).toBeCloseTo(0.01, 2);
    // Mid-price stays constant
    const mid0 = (ticks[0].ask + ticks[0].bid) / 2;
    const mid4 = (ticks[4].ask + ticks[4].bid) / 2;
    expect(mid0).toBeCloseTo(mid4, 2);
  });
});

describe('stale', () => {
  it('generates ticks with zero ask/bid to simulate data outage', () => {
    const ticks = stale(3);

    expect(ticks).toHaveLength(3);
    for (const tick of ticks) {
      expect(tick.ask).toBe(0);
      expect(tick.bid).toBe(0);
      expect(tick.totalAsk).toBe(0);
      expect(tick.totalBid).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/simulator/generators.test.ts`
Expected: FAIL — cannot resolve modules

- [ ] **Step 3: Implement generators.ts**

```typescript
// src/simulator/scenarios/generators.ts

import type { ScenarioTick } from '../types.js';

interface PricePoint {
  ask: number;
  bid: number;
}

interface LinearParams {
  from: PricePoint;
  to: PricePoint;
  ticks: number;
  totalAsk?: number;
  totalBid?: number;
}

interface OscillateParams {
  center: PricePoint;
  amplitude: number;
  period: number;
  ticks: number;
  totalAsk?: number;
  totalBid?: number;
}

interface SpreadSqueezeParams {
  start: PricePoint;
  endSpread: number;
  ticks: number;
  totalAsk?: number;
  totalBid?: number;
}

function interpolate(from: number, to: number, i: number, total: number): number {
  return from + (to - from) * (i / (total - 1));
}

export function linearDrop(params: LinearParams): ScenarioTick[] {
  const { from, to, ticks, totalAsk = 500, totalBid = 500 } = params;
  return Array.from({ length: ticks }, (_, i) => ({
    ask: interpolate(from.ask, to.ask, i, ticks),
    bid: interpolate(from.bid, to.bid, i, ticks),
    totalAsk,
    totalBid,
  }));
}

export function linearRecover(params: LinearParams): ScenarioTick[] {
  return linearDrop(params); // Same interpolation logic, from < to means recovery
}

export function oscillate(params: OscillateParams): ScenarioTick[] {
  const { center, amplitude, period, ticks, totalAsk = 500, totalBid = 500 } = params;
  return Array.from({ length: ticks }, (_, i) => {
    const offset = amplitude * Math.sin((2 * Math.PI * i) / period);
    return {
      ask: center.ask + offset,
      bid: center.bid + offset,
      totalAsk,
      totalBid,
    };
  });
}

export function spreadSqueeze(params: SpreadSqueezeParams): ScenarioTick[] {
  const { start, endSpread, ticks, totalAsk = 500, totalBid = 500 } = params;
  const startSpread = start.ask - start.bid;
  const mid = (start.ask + start.bid) / 2;

  return Array.from({ length: ticks }, (_, i) => {
    const currentSpread = interpolate(startSpread, endSpread, i, ticks);
    return {
      ask: mid + currentSpread / 2,
      bid: mid - currentSpread / 2,
      totalAsk,
      totalBid,
    };
  });
}

export function stale(ticks: number): ScenarioTick[] {
  return Array.from({ length: ticks }, () => ({
    ask: 0,
    bid: 0,
    totalAsk: 0,
    totalBid: 0,
  }));
}
```

- [ ] **Step 4: Create scenarios/index.ts with defineScenario and registry**

```typescript
// src/simulator/scenarios/index.ts

import type { Scenario, ScenarioTick, ScenarioExpectations } from '../types.js';

interface DefineScenarioInput {
  name: string;
  description: string;
  source?: string;
  tickIntervalMs?: number;
  ticks: ScenarioTick[];
  expect?: ScenarioExpectations;
}

export function defineScenario(input: DefineScenarioInput): Scenario {
  return {
    tickIntervalMs: 30_000,
    ...input,
  };
}

const registry = new Map<string, Scenario>();

export function registerScenario(scenario: Scenario): void {
  registry.set(scenario.name, scenario);
}

export function getScenario(name: string): Scenario | undefined {
  return registry.get(name);
}

export function listScenarios(): Scenario[] {
  return Array.from(registry.values());
}

export async function loadBuiltinScenarios(): Promise<void> {
  const modules = import.meta.glob<{ default: Scenario }>('./*.ts', { eager: true });
  for (const [path, mod] of Object.entries(modules)) {
    // Skip index.ts and generators.ts
    const filename = path.split('/').pop() ?? '';
    if (filename === 'index.ts' || filename === 'generators.ts') continue;
    if (mod.default) {
      registerScenario(mod.default);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/simulator/generators.test.ts`
Expected: PASS — all tests green

- [ ] **Step 6: Commit**

```bash
git add src/simulator/scenarios/generators.ts src/simulator/scenarios/index.ts tests/simulator/generators.test.ts
git commit -m "feat(simulator): add scenario generators and registry"
```

---

### Task 3: Mock Clients (ReplayPriceSource & MockBybitClient)

**Files:**
- Create: `src/simulator/mocks/replay-price-source.ts`
- Create: `src/simulator/mocks/mock-bybit-client.ts`
- Test: `tests/simulator/mocks.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/simulator/mocks.test.ts
import { describe, it, expect } from 'vitest';
import { ReplayPriceSource } from '../../src/simulator/mocks/replay-price-source.js';
import { MockBybitClient } from '../../src/simulator/mocks/mock-bybit-client.js';
import type { ScenarioTick } from '../../src/simulator/types.js';

describe('ReplayPriceSource', () => {
  const ticks: ScenarioTick[] = [
    { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
    { ask: 6.91, bid: 6.87, totalAsk: 300, totalBid: 200 },
  ];

  it('returns ticks as PlatformPrices in sequence', async () => {
    const source = new ReplayPriceSource(ticks);
    const first = await source.getUsdtBobPrices();
    expect(first).toHaveLength(1);
    expect(first[0].platform).toBe('bybitp2p');
    expect(first[0].ask).toBe(6.92);
    expect(first[0].bid).toBe(6.89);

    const second = await source.getUsdtBobPrices();
    expect(second[0].ask).toBe(6.91);
  });

  it('returns empty array after all ticks are consumed', async () => {
    const source = new ReplayPriceSource(ticks);
    await source.getUsdtBobPrices(); // tick 0
    await source.getUsdtBobPrices(); // tick 1
    const empty = await source.getUsdtBobPrices(); // past end
    expect(empty).toHaveLength(1);
    expect(empty[0].ask).toBe(0);
    expect(empty[0].bid).toBe(0);
  });

  it('injects clock time into the PlatformPrices', async () => {
    const source = new ReplayPriceSource(ticks);
    source.setTime(60_000);
    const prices = await source.getUsdtBobPrices();
    expect(prices[0].time).toBe(60); // seconds
  });
});

describe('MockBybitClient', () => {
  it('tracks created ads', async () => {
    const client = new MockBybitClient();
    const adId = await client.createAd({
      side: '0', // sell
      price: '6.92',
      amount: '300',
      currencyId: 'USDT',
      fiatId: 'BOB',
      paymentIds: ['1'],
    });

    expect(adId).toBeTruthy();
    expect(client.getAdLog()).toHaveLength(1);
    expect(client.getAdLog()[0].action).toBe('create');
  });

  it('tracks reprices via updateAd', async () => {
    const client = new MockBybitClient();
    const adId = await client.createAd({
      side: '0',
      price: '6.92',
      amount: '300',
      currencyId: 'USDT',
      fiatId: 'BOB',
      paymentIds: ['1'],
    });

    await client.updateAd(adId, 6.93, 300);
    const log = client.getAdLog();
    expect(log).toHaveLength(2);
    expect(log[1].action).toBe('reprice');
    expect(log[1].price).toBe(6.93);
  });

  it('tracks cancellations', async () => {
    const client = new MockBybitClient();
    const adId = await client.createAd({
      side: '0',
      price: '6.92',
      amount: '300',
      currencyId: 'USDT',
      fiatId: 'BOB',
      paymentIds: ['1'],
    });

    await client.cancelAd(adId);
    const log = client.getAdLog();
    expect(log).toHaveLength(2);
    expect(log[1].action).toBe('cancel');
  });

  it('returns configured online ads for getOnlineAds', async () => {
    const client = new MockBybitClient();
    const ads = await client.getOnlineAds('sell', 'USDT', 'BOB');
    expect(ads).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/simulator/mocks.test.ts`
Expected: FAIL — cannot resolve modules

- [ ] **Step 3: Implement ReplayPriceSource**

```typescript
// src/simulator/mocks/replay-price-source.ts

import type { PlatformPrices } from '../../event-bus.js';
import type { ScenarioTick } from '../types.js';

/**
 * CriptoYaClient-compatible mock that returns scenario ticks in sequence.
 * PriceMonitor calls client.getUsdtBobPrices() — this returns the next tick.
 */
export class ReplayPriceSource {
  private readonly ticks: ScenarioTick[];
  private cursor = 0;
  private timeMs = 0;

  constructor(ticks: ScenarioTick[]) {
    this.ticks = ticks;
  }

  setTime(ms: number): void {
    this.timeMs = ms;
  }

  async getUsdtBobPrices(): Promise<PlatformPrices[]> {
    if (this.cursor >= this.ticks.length) {
      return [{
        platform: 'bybitp2p',
        ask: 0,
        bid: 0,
        totalAsk: 0,
        totalBid: 0,
        time: Math.floor(this.timeMs / 1000),
      }];
    }

    const tick = this.ticks[this.cursor++];
    return [{
      platform: 'bybitp2p',
      ask: tick.ask,
      bid: tick.bid,
      totalAsk: tick.totalAsk,
      totalBid: tick.totalBid,
      time: Math.floor(this.timeMs / 1000),
    }];
  }

  async getFees(): Promise<unknown> {
    return {};
  }
}
```

- [ ] **Step 4: Implement MockBybitClient**

```typescript
// src/simulator/mocks/mock-bybit-client.ts

interface AdLogEntry {
  action: 'create' | 'reprice' | 'cancel';
  adId: string;
  side?: string;
  price?: number;
  amount?: number;
  timestamp: number;
}

interface CreateAdParams {
  side: string;
  price: string;
  amount: string;
  currencyId: string;
  fiatId: string;
  paymentIds: string[];
}

/**
 * BybitClient-compatible mock that tracks ad operations in memory.
 * Does not make any real API calls.
 */
export class MockBybitClient {
  private adLog: AdLogEntry[] = [];
  private activeAds = new Map<string, { side: string; price: number; amount: number }>();
  private nextAdId = 1;
  private dryRun = false;

  async createAd(params: CreateAdParams): Promise<string> {
    const adId = `mock-ad-${this.nextAdId++}`;
    this.activeAds.set(adId, {
      side: params.side,
      price: parseFloat(params.price),
      amount: parseFloat(params.amount),
    });
    this.adLog.push({
      action: 'create',
      adId,
      side: params.side,
      price: parseFloat(params.price),
      amount: parseFloat(params.amount),
      timestamp: Date.now(),
    });
    return adId;
  }

  async updateAd(adId: string, price: number, amount: number): Promise<void> {
    const ad = this.activeAds.get(adId);
    if (ad) {
      ad.price = price;
      ad.amount = amount;
    }
    this.adLog.push({
      action: 'reprice',
      adId,
      price,
      amount,
      timestamp: Date.now(),
    });
  }

  async cancelAd(adId: string): Promise<void> {
    this.activeAds.delete(adId);
    this.adLog.push({
      action: 'cancel',
      adId,
      timestamp: Date.now(),
    });
  }

  async getOnlineAds(): Promise<unknown[]> {
    return [];
  }

  async getPaymentMethods(): Promise<Array<{ id: string; bankName: string; accountNo: string; realName: string }>> {
    return [{ id: '1', bankName: 'MockBank', accountNo: '000', realName: 'Test' }];
  }

  async getBalance(): Promise<{ free: string; locked: string }> {
    return { free: '10000', locked: '0' };
  }

  async getPendingOrders(): Promise<unknown[]> {
    return [];
  }

  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  isDryRun(): boolean {
    return this.dryRun;
  }

  getAdLog(): AdLogEntry[] {
    return [...this.adLog];
  }

  getActiveAds(): Map<string, { side: string; price: number; amount: number }> {
    return new Map(this.activeAds);
  }

  clearLog(): void {
    this.adLog = [];
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/simulator/mocks.test.ts`
Expected: PASS — all tests green

- [ ] **Step 6: Commit**

```bash
git add src/simulator/mocks/replay-price-source.ts src/simulator/mocks/mock-bybit-client.ts tests/simulator/mocks.test.ts
git commit -m "feat(simulator): add ReplayPriceSource and MockBybitClient"
```

---

### Task 4: Unit Mode Engine

**Files:**
- Create: `src/simulator/engine.ts`
- Test: `tests/simulator/engine-unit.test.ts`

- [ ] **Step 1: Write the failing test for runUnit()**

```typescript
// tests/simulator/engine-unit.test.ts
import { describe, it, expect } from 'vitest';
import { runUnit } from '../../src/simulator/engine.js';
import type { Scenario } from '../../src/simulator/types.js';

describe('runUnit', () => {
  const config = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };
  const volatilityConfig = { volatilityThresholdPercent: 2, volatilityWindowMinutes: 5 };

  it('produces a timeline entry per tick with pricing results', () => {
    const scenario: Scenario = {
      name: 'test-basic',
      description: 'Basic pricing test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
        { ask: 6.910, bid: 6.875, totalAsk: 300, totalBid: 200 },
      ],
    };

    const result = runUnit(scenario, config, volatilityConfig);

    expect(result.timeline).toHaveLength(2);
    expect(result.timeline[0].tick).toBe(1);
    expect(result.timeline[0].buyPrice).toBeTypeOf('number');
    expect(result.timeline[0].sellPrice).toBeTypeOf('number');
    expect(result.timeline[0].elapsed).toBe('00:00:00');
    expect(result.timeline[1].elapsed).toBe('00:00:30');
  });

  it('detects volatility when price changes exceed threshold', () => {
    // 2% threshold, 5 min window. With 30s ticks, all within window.
    // Price drops from 6.92 to 6.70 = 3.2% drop
    const scenario: Scenario = {
      name: 'test-volatility',
      description: 'Volatility detection',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.900, totalAsk: 500, totalBid: 500 },
        { ask: 6.850, bid: 6.830, totalAsk: 500, totalBid: 500 },
        { ask: 6.780, bid: 6.760, totalAsk: 500, totalBid: 500 },
        { ask: 6.710, bid: 6.690, totalAsk: 500, totalBid: 500 },
      ],
    };

    const result = runUnit(scenario, config, volatilityConfig);

    const volatilityEvents = result.timeline.filter((t) =>
      t.events.some((e) => e.includes('volatility')),
    );
    expect(volatilityEvents.length).toBeGreaterThan(0);
  });

  it('marks paused when no valid prices (stale tick)', () => {
    const scenario: Scenario = {
      name: 'test-stale',
      description: 'Stale data test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
        { ask: 0, bid: 0, totalAsk: 0, totalBid: 0 },
      ],
    };

    const result = runUnit(scenario, config, volatilityConfig);

    expect(result.timeline[1].paused).toBe(true);
    expect(result.timeline[1].buyPrice).toBeNull();
    expect(result.timeline[1].sellPrice).toBeNull();
  });

  it('populates summary correctly', () => {
    const scenario: Scenario = {
      name: 'test-summary',
      description: 'Summary test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
        { ask: 6.910, bid: 6.875, totalAsk: 300, totalBid: 200 },
      ],
    };

    const result = runUnit(scenario, config, volatilityConfig);

    expect(result.summary.totalTicks).toBe(2);
    expect(result.summary.simulatedDuration).toBe('00:00:30');
    expect(result.mode).toBe('unit');
    expect(result.scenario).toBe('test-summary');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/simulator/engine-unit.test.ts`
Expected: FAIL — cannot resolve `engine.js`

- [ ] **Step 3: Implement engine.ts with runUnit()**

```typescript
// src/simulator/engine.ts

import { calculatePricing } from '../modules/ad-manager/pricing.js';
import type { PricingConfig } from '../modules/ad-manager/types.js';
import { SimulatedClock } from './clock.js';
import { tickToPlatformPrices } from './types.js';
import type {
  Scenario,
  SimulationResult,
  SimulationSummary,
  TimelineEntry,
} from './types.js';

interface VolatilityConfig {
  volatilityThresholdPercent: number;
  volatilityWindowMinutes: number;
}

interface PriceSnapshot {
  price: number;
  timestamp: number;
}

function checkVolatility(
  currentPrice: number,
  now: number,
  window: PriceSnapshot[],
  config: VolatilityConfig,
): { alert: boolean; changePercent: number } {
  const windowMs = config.volatilityWindowMinutes * 60 * 1000;

  // Trim old entries
  while (window.length > 0 && now - window[0].timestamp > windowMs) {
    window.shift();
  }

  let alert = false;
  let changePercent = 0;

  if (window.length > 0) {
    const oldest = window[0];
    changePercent = Math.abs((currentPrice - oldest.price) / oldest.price) * 100;
    alert = changePercent > config.volatilityThresholdPercent;
  }

  window.push({ price: currentPrice, timestamp: now });
  return { alert, changePercent };
}

function buildSummary(timeline: TimelineEntry[], clock: SimulatedClock, scenario: Scenario): SimulationSummary {
  const spreads = timeline
    .filter((t) => t.botSpread !== null)
    .map((t) => t.botSpread as number);

  const emergencyEntry = timeline.find((t) =>
    t.events.some((e) => e.includes('emergency')),
  );

  return {
    totalTicks: timeline.length,
    simulatedDuration: clock.elapsed(),
    repriceCount: timeline.filter((t) =>
      t.events.some((e) => e.includes('repriced')),
    ).length,
    pauseCount: timeline.filter((t) => t.paused).length,
    emergencyTriggered: !!emergencyEntry,
    emergencyAtTick: emergencyEntry?.tick ?? null,
    emergencyReason: emergencyEntry
      ? emergencyEntry.events.find((e) => e.includes('emergency')) ?? null
      : null,
    maxSpread: spreads.length > 0 ? Math.max(...spreads) : 0,
    minSpread: spreads.length > 0 ? Math.min(...spreads) : 0,
  };
}

export function runUnit(
  scenario: Scenario,
  pricingConfig: PricingConfig,
  volatilityConfig: VolatilityConfig,
): SimulationResult {
  const clock = new SimulatedClock(0);
  const priceWindow: PriceSnapshot[] = [];
  const timeline: TimelineEntry[] = [];
  let prevBuyPrice: number | null = null;
  let prevSellPrice: number | null = null;

  for (const tick of scenario.ticks) {
    const events: string[] = [];
    const prices = [tickToPlatformPrices(tick, clock.now())];
    const result = calculatePricing(prices, pricingConfig);

    const paused = result.paused.buy || result.paused.sell;
    let buyPrice: number | null = null;
    let sellPrice: number | null = null;
    let botSpread: number | null = null;

    if (!paused) {
      buyPrice = result.buyPrice;
      sellPrice = result.sellPrice;
      botSpread = result.spread;

      // Detect reprices
      if (prevBuyPrice !== null && prevSellPrice !== null) {
        if (Math.abs(buyPrice - prevBuyPrice) > 0.0001 || Math.abs(sellPrice - prevSellPrice) > 0.0001) {
          events.push(`repriced(buy:${buyPrice.toFixed(3)},sell:${sellPrice.toFixed(3)})`);
        }
      } else {
        events.push(`priced(buy:${buyPrice.toFixed(3)},sell:${sellPrice.toFixed(3)})`);
      }
      prevBuyPrice = buyPrice;
      prevSellPrice = sellPrice;
    } else {
      events.push(`paused(${result.paused.reason ?? 'unknown'})`);
      prevBuyPrice = null;
      prevSellPrice = null;
    }

    // Volatility check (use bid as reference price, matching PriceMonitor)
    if (tick.bid > 0) {
      const vol = checkVolatility(tick.bid, clock.now(), priceWindow, volatilityConfig);
      if (vol.alert) {
        events.push(`volatility-alert(${vol.changePercent.toFixed(1)}%)`);
      }
    }

    timeline.push({
      tick: clock.tickCount + 1,
      elapsed: clock.elapsed(),
      ask: tick.ask,
      bid: tick.bid,
      marketSpread: tick.ask > 0 && tick.bid > 0 ? tick.ask - tick.bid : 0,
      buyPrice,
      sellPrice,
      botSpread,
      events,
      paused,
      pauseReason: paused ? result.paused.reason : undefined,
    });

    clock.advance(scenario.tickIntervalMs);
  }

  return {
    scenario: scenario.name,
    mode: 'unit',
    timeline,
    summary: buildSummary(timeline, clock, scenario),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/simulator/engine-unit.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 5: Commit**

```bash
git add src/simulator/engine.ts tests/simulator/engine-unit.test.ts
git commit -m "feat(simulator): implement unit mode engine"
```

---

### Task 5: Integration Mode Engine

**Files:**
- Modify: `src/simulator/engine.ts` (add `runIntegration()`)
- Test: `tests/simulator/engine-integration.test.ts`

- [ ] **Step 1: Write the failing test for runIntegration()**

```typescript
// tests/simulator/engine-integration.test.ts
import { describe, it, expect } from 'vitest';
import { runIntegration } from '../../src/simulator/engine.js';
import type { Scenario } from '../../src/simulator/types.js';

describe('runIntegration', () => {
  const config = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };
  const volatilityConfig = { volatilityThresholdPercent: 2, volatilityWindowMinutes: 5 };

  it('runs scenario through full module stack and captures events', async () => {
    const scenario: Scenario = {
      name: 'integration-basic',
      description: 'Basic integration test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
        { ask: 6.910, bid: 6.875, totalAsk: 300, totalBid: 200 },
        { ask: 6.900, bid: 6.860, totalAsk: 300, totalBid: 200 },
      ],
    };

    const result = await runIntegration(scenario, config, volatilityConfig);

    expect(result.mode).toBe('integration');
    expect(result.timeline).toHaveLength(3);
    expect(result.summary.totalTicks).toBe(3);
  });

  it('triggers emergency stop on flash crash', async () => {
    const scenario: Scenario = {
      name: 'integration-crash',
      description: 'Flash crash triggers emergency',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.900, totalAsk: 500, totalBid: 500 },
        { ask: 6.850, bid: 6.830, totalAsk: 500, totalBid: 500 },
        { ask: 6.780, bid: 6.760, totalAsk: 500, totalBid: 500 },
        { ask: 6.710, bid: 6.690, totalAsk: 500, totalBid: 500 },
        { ask: 6.640, bid: 6.620, totalAsk: 500, totalBid: 500 },
      ],
    };

    const result = await runIntegration(scenario, config, volatilityConfig);

    expect(result.summary.emergencyTriggered).toBe(true);
  });

  it('captures ad operations from MockBybitClient in timeline', async () => {
    const scenario: Scenario = {
      name: 'integration-ads',
      description: 'Ad operations tracking',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
        { ask: 6.910, bid: 6.875, totalAsk: 300, totalBid: 200 },
      ],
    };

    const result = await runIntegration(scenario, config, volatilityConfig);

    // First tick should show ad creation or pricing
    const allEvents = result.timeline.flatMap((t) => t.events);
    expect(allEvents.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/simulator/engine-integration.test.ts`
Expected: FAIL — `runIntegration` is not exported

- [ ] **Step 3: Implement runIntegration() in engine.ts**

Add the following to `src/simulator/engine.ts`:

```typescript
import { EventBus } from '../event-bus.js';
import type { EventMap } from '../event-bus.js';
import { createTestDB } from '../db/index.js';
import { PriceMonitor } from '../modules/price-monitor/index.js';
import { AdManager } from '../modules/ad-manager/index.js';
import { EmergencyStop } from '../modules/emergency-stop/index.js';
import { ReplayPriceSource } from './mocks/replay-price-source.js';
import { MockBybitClient } from './mocks/mock-bybit-client.js';

export async function runIntegration(
  scenario: Scenario,
  pricingConfig: PricingConfig,
  volatilityConfig: VolatilityConfig,
): Promise<SimulationResult> {
  const { db, close } = createTestDB();
  const bus = new EventBus(db);
  const clock = new SimulatedClock(0);

  // Mock clients
  const replaySource = new ReplayPriceSource(scenario.ticks);
  const mockBybit = new MockBybitClient();

  // Wire real modules with mocked dependencies
  const priceMonitor = new PriceMonitor(
    bus,
    db,
    replaySource as any,
    volatilityConfig,
    mockBybit as any,
  );

  const adManager = new AdManager(
    bus,
    db,
    mockBybit as any,
    pricingConfig,
    () => ({ id: 1, name: 'MockBank' }), // Always return a bank account
  );

  const emergencyStop = new EmergencyStop(bus, db, {
    removeAllAds: () => adManager.removeAllAds(),
    getExposure: async () => ({ usdt: 0, bob: 0 }),
    getMarketState: () => {
      const prices = priceMonitor.getLatestPrices();
      const p = prices[0];
      return { ask: p?.ask ?? 0, bid: p?.bid ?? 0 };
    },
    getPendingOrderCount: () => 0,
    stopPolling: () => {},
    startPolling: () => {},
  });

  // Capture all events into timeline
  const timeline: TimelineEntry[] = [];
  const pendingEvents: string[] = [];

  const trackedEvents: (keyof EventMap)[] = [
    'price:updated',
    'price:volatility-alert',
    'price:stale',
    'ad:created',
    'ad:repriced',
    'ad:paused',
    'ad:resumed',
    'ad:spread-inversion',
    'emergency:triggered',
    'emergency:resolved',
  ];

  for (const event of trackedEvents) {
    bus.on(event, (payload: any) => {
      let label = event;
      if (event === 'ad:created') label = `ad:created(${payload.side})`;
      if (event === 'ad:repriced') label = `ad:repriced(${payload.side},${payload.newPrice?.toFixed(3)})`;
      if (event === 'ad:paused') label = `ad:paused(${payload.reason})`;
      if (event === 'price:volatility-alert') label = `volatility-alert(${payload.changePercent.toFixed(1)}%)`;
      if (event === 'emergency:triggered') label = `emergency:triggered(${payload.trigger})`;
      pendingEvents.push(label);
    });
  }

  // Run each tick
  for (let i = 0; i < scenario.ticks.length; i++) {
    const tick = scenario.ticks[i];
    pendingEvents.length = 0; // Clear events for this tick

    // Set the clock time on replay source
    replaySource.setTime(clock.now());

    // Run PriceMonitor fetch (will read from ReplayPriceSource)
    await priceMonitor.fetchOnce();

    // Run AdManager tick (will react to price:updated)
    if (emergencyStop.getState() !== 'emergency') {
      await adManager.tick();
    }

    // Gather current pricing state
    const pricing = calculatePricing(
      [tickToPlatformPrices(tick, clock.now())],
      pricingConfig,
    );
    const paused = pricing.paused.buy || pricing.paused.sell;

    timeline.push({
      tick: i + 1,
      elapsed: clock.elapsed(),
      ask: tick.ask,
      bid: tick.bid,
      marketSpread: tick.ask > 0 && tick.bid > 0 ? tick.ask - tick.bid : 0,
      buyPrice: paused ? null : pricing.buyPrice,
      sellPrice: paused ? null : pricing.sellPrice,
      botSpread: paused ? null : pricing.spread,
      events: [...pendingEvents],
      paused,
      pauseReason: paused ? pricing.paused.reason : undefined,
    });

    clock.advance(scenario.tickIntervalMs);
  }

  close();

  return {
    scenario: scenario.name,
    mode: 'integration',
    timeline,
    summary: buildSummary(timeline, clock, scenario),
  };
}
```

Note: The imports at the top of `engine.ts` need to be consolidated. The final file should have all imports at the top, with both `runUnit()` and `runIntegration()` exported.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/simulator/engine-integration.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 5: Commit**

```bash
git add src/simulator/engine.ts tests/simulator/engine-integration.test.ts
git commit -m "feat(simulator): implement integration mode engine"
```

---

### Task 6: Assertions Runner

**Files:**
- Create: `src/simulator/output/assertions.ts`
- Test: `tests/simulator/assertions.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/simulator/assertions.test.ts
import { describe, it, expect } from 'vitest';
import { runAssertions } from '../../src/simulator/output/assertions.js';
import type { SimulationResult, ScenarioExpectations } from '../../src/simulator/types.js';

function makeResult(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    scenario: 'test',
    mode: 'unit',
    timeline: [
      { tick: 1, elapsed: '00:00:00', ask: 6.92, bid: 6.89, marketSpread: 0.03, buyPrice: 6.89, sellPrice: 6.92, botSpread: 0.03, events: ['priced(buy:6.890,sell:6.920)'], paused: false },
      { tick: 2, elapsed: '00:00:30', ask: 6.91, bid: 6.87, marketSpread: 0.04, buyPrice: 6.87, sellPrice: 6.91, botSpread: 0.04, events: ['repriced(buy:6.870,sell:6.910)'], paused: false },
      { tick: 3, elapsed: '00:01:00', ask: 6.85, bid: 6.80, marketSpread: 0.05, buyPrice: null, sellPrice: null, botSpread: null, events: ['volatility-alert(3.2%)', 'emergency:triggered(volatility)'], paused: true, pauseReason: 'no valid market prices' },
    ],
    summary: {
      totalTicks: 3,
      simulatedDuration: '00:01:00',
      repriceCount: 1,
      pauseCount: 1,
      emergencyTriggered: true,
      emergencyAtTick: 3,
      emergencyReason: 'emergency:triggered(volatility)',
      maxSpread: 0.04,
      minSpread: 0.03,
    },
    ...overrides,
  };
}

describe('runAssertions', () => {
  it('passes when emergencyTriggered matches', () => {
    const expectations: ScenarioExpectations = { emergencyTriggered: true };
    const results = runAssertions(makeResult(), expectations);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('fails when emergencyTriggered does not match', () => {
    const expectations: ScenarioExpectations = { emergencyTriggered: false };
    const results = runAssertions(makeResult(), expectations);
    expect(results.some((r) => !r.passed)).toBe(true);
  });

  it('passes emergencyByTick when emergency is early enough', () => {
    const expectations: ScenarioExpectations = { emergencyByTick: 5 };
    const results = runAssertions(makeResult(), expectations);
    const byTick = results.find((r) => r.name === 'emergencyByTick');
    expect(byTick?.passed).toBe(true);
  });

  it('fails emergencyByTick when emergency is too late', () => {
    const expectations: ScenarioExpectations = { emergencyByTick: 2 };
    const results = runAssertions(makeResult(), expectations);
    const byTick = results.find((r) => r.name === 'emergencyByTick');
    expect(byTick?.passed).toBe(false);
  });

  it('passes spreadNeverBelow when all spreads are above threshold', () => {
    const expectations: ScenarioExpectations = { spreadNeverBelow: 0.02 };
    const results = runAssertions(makeResult(), expectations);
    const spread = results.find((r) => r.name === 'spreadNeverBelow');
    expect(spread?.passed).toBe(true);
  });

  it('fails spreadNeverBelow when a spread is below threshold', () => {
    const expectations: ScenarioExpectations = { spreadNeverBelow: 0.035 };
    const results = runAssertions(makeResult(), expectations);
    const spread = results.find((r) => r.name === 'spreadNeverBelow');
    expect(spread?.passed).toBe(false);
  });

  it('checks maxRepricesBeforeEmergency', () => {
    const expectations: ScenarioExpectations = { maxRepricesBeforeEmergency: 5 };
    const results = runAssertions(makeResult(), expectations);
    const reprices = results.find((r) => r.name === 'maxRepricesBeforeEmergency');
    expect(reprices?.passed).toBe(true); // 1 reprice <= 5
  });

  it('checks noAdsActiveDuring', () => {
    // Ticks 3 is paused (buyPrice is null), so no ads active at tick 3
    const expectations: ScenarioExpectations = { noAdsActiveDuring: [3, 3] };
    const results = runAssertions(makeResult(), expectations);
    const noAds = results.find((r) => r.name === 'noAdsActiveDuring');
    expect(noAds?.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/simulator/assertions.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Implement assertions.ts**

```typescript
// src/simulator/output/assertions.ts

import type { SimulationResult, ScenarioExpectations } from '../types.js';

export interface AssertionResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export function runAssertions(
  result: SimulationResult,
  expectations: ScenarioExpectations,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (expectations.emergencyTriggered !== undefined) {
    results.push({
      name: 'emergencyTriggered',
      passed: result.summary.emergencyTriggered === expectations.emergencyTriggered,
      expected: String(expectations.emergencyTriggered),
      actual: String(result.summary.emergencyTriggered),
    });
  }

  if (expectations.emergencyByTick !== undefined) {
    const actual = result.summary.emergencyAtTick;
    const passed = actual !== null && actual <= expectations.emergencyByTick;
    results.push({
      name: 'emergencyByTick',
      passed,
      expected: `<= ${expectations.emergencyByTick}`,
      actual: actual !== null ? `tick ${actual}` : 'no emergency',
    });
  }

  if (expectations.maxRepricesBeforeEmergency !== undefined) {
    const emergencyTick = result.summary.emergencyAtTick ?? result.summary.totalTicks + 1;
    const repricesBeforeEmergency = result.timeline
      .filter((t) => t.tick < emergencyTick)
      .filter((t) => t.events.some((e) => e.includes('repriced')))
      .length;
    const passed = repricesBeforeEmergency <= expectations.maxRepricesBeforeEmergency;
    results.push({
      name: 'maxRepricesBeforeEmergency',
      passed,
      expected: `<= ${expectations.maxRepricesBeforeEmergency}`,
      actual: String(repricesBeforeEmergency),
    });
  }

  if (expectations.noAdsActiveDuring !== undefined) {
    const [startTick, endTick] = expectations.noAdsActiveDuring;
    const violatingTicks = result.timeline
      .filter((t) => t.tick >= startTick && t.tick <= endTick)
      .filter((t) => t.buyPrice !== null || t.sellPrice !== null);
    results.push({
      name: 'noAdsActiveDuring',
      passed: violatingTicks.length === 0,
      expected: `no ads active during ticks ${startTick}-${endTick}`,
      actual: violatingTicks.length === 0
        ? 'no ads active'
        : `ads active at ticks ${violatingTicks.map((t) => t.tick).join(', ')}`,
    });
  }

  if (expectations.spreadNeverBelow !== undefined) {
    const violatingSpreads = result.timeline
      .filter((t) => t.botSpread !== null && t.botSpread < expectations.spreadNeverBelow!);
    results.push({
      name: 'spreadNeverBelow',
      passed: violatingSpreads.length === 0,
      expected: `>= ${expectations.spreadNeverBelow}`,
      actual: violatingSpreads.length === 0
        ? 'all spreads above threshold'
        : `spread ${Math.min(...violatingSpreads.map((t) => t.botSpread!))} at tick ${violatingSpreads[0].tick}`,
    });
  }

  return results;
}

export function formatAssertions(results: AssertionResult[]): string {
  const lines = results.map((r) => {
    const icon = r.passed ? '\u2713' : '\u2717';
    return `  ${icon} ${r.name}: ${r.passed ? 'passed' : 'FAILED'} (expected: ${r.expected}, actual: ${r.actual})`;
  });

  const passCount = results.filter((r) => r.passed).length;
  lines.push('');
  lines.push(`  ${passCount}/${results.length} assertions passed`);

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/simulator/assertions.test.ts`
Expected: PASS — all 8 tests green

- [ ] **Step 5: Commit**

```bash
git add src/simulator/output/assertions.ts tests/simulator/assertions.test.ts
git commit -m "feat(simulator): add assertion runner and reporter"
```

---

### Task 7: Output Formatters (Table & JSON)

**Files:**
- Create: `src/simulator/output/table.ts`
- Create: `src/simulator/output/json.ts`
- Test: `tests/simulator/output.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/simulator/output.test.ts
import { describe, it, expect } from 'vitest';
import { formatTable } from '../../src/simulator/output/table.js';
import { formatJson } from '../../src/simulator/output/json.js';
import type { SimulationResult } from '../../src/simulator/types.js';

const result: SimulationResult = {
  scenario: 'test',
  mode: 'unit',
  timeline: [
    { tick: 1, elapsed: '00:00:00', ask: 6.920, bid: 6.890, marketSpread: 0.030, buyPrice: 6.890, sellPrice: 6.920, botSpread: 0.030, events: ['priced(buy:6.890,sell:6.920)'], paused: false },
    { tick: 2, elapsed: '00:00:30', ask: 6.910, bid: 6.875, marketSpread: 0.035, buyPrice: 6.875, sellPrice: 6.910, botSpread: 0.035, events: ['repriced(buy:6.875,sell:6.910)'], paused: false },
  ],
  summary: {
    totalTicks: 2,
    simulatedDuration: '00:00:30',
    repriceCount: 1,
    pauseCount: 0,
    emergencyTriggered: false,
    emergencyAtTick: null,
    emergencyReason: null,
    maxSpread: 0.035,
    minSpread: 0.030,
  },
};

describe('formatTable', () => {
  it('outputs a table with headers and rows', () => {
    const output = formatTable(result);
    expect(output).toContain('Tick');
    expect(output).toContain('Time');
    expect(output).toContain('Ask');
    expect(output).toContain('Bid');
    expect(output).toContain('6.920');
    expect(output).toContain('6.890');
  });

  it('includes summary section', () => {
    const output = formatTable(result);
    expect(output).toContain('Summary');
    expect(output).toContain('Ticks: 2');
    expect(output).toContain('Reprices: 1');
    expect(output).toContain('Emergency: NO');
  });
});

describe('formatJson', () => {
  it('returns valid JSON', () => {
    const output = formatJson(result);
    const parsed = JSON.parse(output);
    expect(parsed.scenario).toBe('test');
    expect(parsed.timeline).toHaveLength(2);
    expect(parsed.summary.totalTicks).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/simulator/output.test.ts`
Expected: FAIL — cannot resolve modules

- [ ] **Step 3: Implement table.ts**

```typescript
// src/simulator/output/table.ts

import type { SimulationResult } from '../types.js';

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

function padStart(str: string, len: number): string {
  return str.padStart(len);
}

export function formatTable(result: SimulationResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`\nScenario: ${result.scenario} (${result.mode} mode)\n`);

  const headers = ['Tick', 'Time', 'Ask', 'Bid', 'Spread', 'Buy Price', 'Sell Price', 'Events'];
  const widths = [6, 10, 8, 8, 8, 11, 11, 40];

  const headerRow = headers.map((h, i) => pad(h, widths[i])).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');

  lines.push(headerRow);
  lines.push(separator);

  for (const entry of result.timeline) {
    const row = [
      padStart(String(entry.tick), widths[0]),
      pad(entry.elapsed, widths[1]),
      padStart(entry.ask > 0 ? entry.ask.toFixed(3) : '--', widths[2]),
      padStart(entry.bid > 0 ? entry.bid.toFixed(3) : '--', widths[3]),
      padStart(entry.botSpread !== null ? entry.botSpread.toFixed(3) : '--', widths[4]),
      padStart(entry.buyPrice !== null ? entry.buyPrice.toFixed(3) : '--', widths[5]),
      padStart(entry.sellPrice !== null ? entry.sellPrice.toFixed(3) : '--', widths[6]),
      pad(entry.events.join(', ').slice(0, widths[7]), widths[7]),
    ];
    lines.push(row.join(' | '));
  }

  // Summary
  lines.push('');
  lines.push('Summary:');
  lines.push(`  Ticks: ${result.summary.totalTicks} | Duration: ${result.summary.simulatedDuration} (simulated)`);
  lines.push(`  Reprices: ${result.summary.repriceCount} | Pauses: ${result.summary.pauseCount} | Emergency: ${result.summary.emergencyTriggered ? `YES (tick ${result.summary.emergencyAtTick})` : 'NO'}`);
  lines.push(`  Max spread: ${result.summary.maxSpread.toFixed(3)} | Min spread: ${result.summary.minSpread.toFixed(3)}`);

  if (result.summary.emergencyTriggered) {
    lines.push(`  Exit: EMERGENCY at tick ${result.summary.emergencyAtTick}`);
  }

  lines.push('');

  return lines.join('\n');
}
```

- [ ] **Step 4: Implement json.ts**

```typescript
// src/simulator/output/json.ts

import type { SimulationResult } from '../types.js';

export function formatJson(result: SimulationResult): string {
  return JSON.stringify(result, null, 2);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/simulator/output.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 6: Commit**

```bash
git add src/simulator/output/table.ts src/simulator/output/json.ts tests/simulator/output.test.ts
git commit -m "feat(simulator): add table and JSON output formatters"
```

---

### Task 8: CLI Entry Point

**Files:**
- Create: `src/simulator/index.ts`
- Modify: `package.json` (add `simulate` script)

- [ ] **Step 1: Implement the CLI entry point**

```typescript
// src/simulator/index.ts

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runUnit, runIntegration } from './engine.js';
import { loadBuiltinScenarios, getScenario, listScenarios } from './scenarios/index.js';
import { formatTable } from './output/table.js';
import { formatJson } from './output/json.js';
import { runAssertions, formatAssertions } from './output/assertions.js';
import type { Scenario, ScenarioExpectations } from './types.js';

function parseArgs(args: string[]): {
  file?: string;
  scenario?: string;
  mode: 'unit' | 'integration';
  output: 'table' | 'json';
  list: boolean;
  noAssert: boolean;
  configOverrides: Record<string, string>;
} {
  const result = {
    file: undefined as string | undefined,
    scenario: undefined as string | undefined,
    mode: 'integration' as 'unit' | 'integration',
    output: 'table' as 'table' | 'json',
    list: false,
    noAssert: false,
    configOverrides: {} as Record<string, string>,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
        result.file = args[++i];
        break;
      case '--scenario':
        result.scenario = args[++i];
        break;
      case '--mode':
        result.mode = args[++i] as 'unit' | 'integration';
        break;
      case '--output':
        result.output = args[++i] as 'table' | 'json';
        break;
      case '--list':
        result.list = true;
        break;
      case '--no-assert':
        result.noAssert = true;
        break;
      case '--config': {
        const pairs = args[++i].split(',');
        for (const pair of pairs) {
          const [key, value] = pair.split('=');
          result.configOverrides[key] = value;
        }
        break;
      }
    }
  }

  return result;
}

async function loadScenarioFromFile(filePath: string): Promise<Scenario> {
  const absPath = resolve(filePath);
  const content = await readFile(absPath, 'utf-8');
  const data = JSON.parse(content);

  if (!data.name || !data.ticks || !Array.isArray(data.ticks)) {
    throw new Error(`Invalid scenario file: missing "name" or "ticks" array`);
  }

  return {
    name: data.name,
    description: data.description ?? '',
    source: data.source,
    tickIntervalMs: data.tickIntervalMs ?? 30_000,
    ticks: data.ticks,
    expect: data.expect,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Load built-in scenarios
  await loadBuiltinScenarios();

  // List mode
  if (args.list) {
    const scenarios = listScenarios();
    console.log('\nAvailable scenarios:\n');
    for (const s of scenarios) {
      console.log(`  ${s.name.padEnd(25)} ${s.description}`);
    }
    console.log('');
    process.exit(0);
  }

  // Load scenario
  let scenario: Scenario;

  if (args.file) {
    scenario = await loadScenarioFromFile(args.file);
  } else if (args.scenario) {
    const found = getScenario(args.scenario);
    if (!found) {
      console.error(`Unknown scenario: "${args.scenario}". Use --list to see available scenarios.`);
      process.exit(2);
    }
    scenario = found;
  } else {
    console.error('Provide --file <path> or --scenario <name>. Use --list to see built-in scenarios.');
    process.exit(2);
  }

  // Apply config overrides
  const pricingConfig = {
    minSpread: parseFloat(args.configOverrides.min_spread ?? '0.015'),
    maxSpread: parseFloat(args.configOverrides.max_spread ?? '0.05'),
    tradeAmountUsdt: parseFloat(args.configOverrides.trade_amount_usdt ?? '300'),
  };

  const volatilityConfig = {
    volatilityThresholdPercent: parseFloat(args.configOverrides.volatility_threshold_percent ?? '2'),
    volatilityWindowMinutes: parseFloat(args.configOverrides.volatility_window_minutes ?? '5'),
  };

  // Run simulation
  const result = args.mode === 'unit'
    ? runUnit(scenario, pricingConfig, volatilityConfig)
    : await runIntegration(scenario, pricingConfig, volatilityConfig);

  // Output
  if (args.output === 'json') {
    console.log(formatJson(result));
  } else {
    console.log(formatTable(result));
  }

  // Assertions
  let assertionsFailed = false;
  if (scenario.expect && !args.noAssert) {
    const assertionResults = runAssertions(result, scenario.expect);
    console.log(formatAssertions(assertionResults));
    assertionsFailed = assertionResults.some((r) => !r.passed);
  }

  process.exit(assertionsFailed ? 1 : 0);
}

main().catch((err) => {
  console.error('Simulation failed:', err.message);
  process.exit(2);
});
```

- [ ] **Step 2: Add the `simulate` script to package.json**

Add to the `"scripts"` section of `package.json`:

```json
"simulate": "tsx src/simulator/index.ts"
```

- [ ] **Step 3: Smoke test the CLI**

Run: `npm run simulate -- --list`
Expected: Prints "Available scenarios:" (empty list since no built-in scenarios registered yet). Exit code 0.

Run: `npm run simulate`
Expected: Prints error message about providing `--file` or `--scenario`. Exit code 2.

- [ ] **Step 4: Commit**

```bash
git add src/simulator/index.ts package.json
git commit -m "feat(simulator): add CLI entry point and simulate script"
```

---

### Task 9: Built-in Synthetic Scenarios

**Files:**
- Create: `src/simulator/scenarios/flash-crash-5pct.ts`
- Create: `src/simulator/scenarios/flash-crash-10pct.ts`
- Create: `src/simulator/scenarios/spread-squeeze.ts`
- Create: `src/simulator/scenarios/spread-inversion.ts`
- Create: `src/simulator/scenarios/oscillation.ts`
- Create: `src/simulator/scenarios/slow-drift.ts`
- Create: `src/simulator/scenarios/stale-then-spike.ts`
- Create: `src/simulator/scenarios/thin-book.ts`

- [ ] **Step 1: Create flash-crash-5pct.ts**

```typescript
// src/simulator/scenarios/flash-crash-5pct.ts

import { defineScenario } from './index.js';
import { linearDrop, linearRecover } from './generators.js';

export default defineScenario({
  name: 'flash-crash-5pct',
  description: 'Price drops 5% over 10 ticks then recovers over 15',
  tickIntervalMs: 30_000,
  ticks: [
    ...linearDrop({
      from: { ask: 6.920, bid: 6.890 },
      to: { ask: 6.574, bid: 6.546 },
      ticks: 10,
    }),
    ...linearRecover({
      from: { ask: 6.574, bid: 6.546 },
      to: { ask: 6.900, bid: 6.870 },
      ticks: 15,
    }),
  ],
  expect: {
    emergencyTriggered: true,
    emergencyByTick: 12,
    spreadNeverBelow: 0.015,
  },
});
```

- [ ] **Step 2: Create flash-crash-10pct.ts**

```typescript
// src/simulator/scenarios/flash-crash-10pct.ts

import { defineScenario } from './index.js';
import { linearDrop } from './generators.js';

export default defineScenario({
  name: 'flash-crash-10pct',
  description: 'Price drops 10% over 5 ticks with no recovery',
  tickIntervalMs: 30_000,
  ticks: linearDrop({
    from: { ask: 6.920, bid: 6.890 },
    to: { ask: 6.228, bid: 6.201 },
    ticks: 5,
  }),
  expect: {
    emergencyTriggered: true,
    emergencyByTick: 5,
    spreadNeverBelow: 0.015,
  },
});
```

- [ ] **Step 3: Create spread-squeeze.ts**

```typescript
// src/simulator/scenarios/spread-squeeze.ts

import { defineScenario } from './index.js';
import { spreadSqueeze } from './generators.js';

export default defineScenario({
  name: 'spread-squeeze',
  description: 'Ask and bid converge until spread drops below min_spread',
  tickIntervalMs: 30_000,
  ticks: spreadSqueeze({
    start: { ask: 6.920, bid: 6.880 },
    endSpread: 0.005,
    ticks: 20,
  }),
});
```

- [ ] **Step 4: Create spread-inversion.ts**

```typescript
// src/simulator/scenarios/spread-inversion.ts

import { defineScenario } from './index.js';
import type { ScenarioTick } from '../types.js';

// Manually craft ticks where bid crosses above ask
const ticks: ScenarioTick[] = [
  { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 500 },
  { ask: 6.910, bid: 6.900, totalAsk: 500, totalBid: 500 },
  { ask: 6.900, bid: 6.910, totalAsk: 500, totalBid: 500 }, // inverted
  { ask: 6.890, bid: 6.920, totalAsk: 500, totalBid: 500 }, // more inverted
];

export default defineScenario({
  name: 'spread-inversion',
  description: 'Bid crosses above ask over 3 ticks',
  tickIntervalMs: 30_000,
  ticks,
  expect: {
    emergencyTriggered: true,
  },
});
```

- [ ] **Step 5: Create oscillation.ts**

```typescript
// src/simulator/scenarios/oscillation.ts

import { defineScenario } from './index.js';
import { oscillate } from './generators.js';

export default defineScenario({
  name: 'oscillation',
  description: 'Price swings +/-1.5% every 4 ticks for 30 ticks',
  tickIntervalMs: 30_000,
  ticks: oscillate({
    center: { ask: 6.920, bid: 6.890 },
    amplitude: 0.104, // ~1.5% of 6.9
    period: 4,
    ticks: 30,
  }),
  expect: {
    spreadNeverBelow: 0.015,
  },
});
```

- [ ] **Step 6: Create slow-drift.ts**

```typescript
// src/simulator/scenarios/slow-drift.ts

import { defineScenario } from './index.js';
import { linearDrop } from './generators.js';

export default defineScenario({
  name: 'slow-drift',
  description: '3% drop over 60 ticks (30 min simulated) — just under volatility threshold',
  tickIntervalMs: 30_000,
  ticks: linearDrop({
    from: { ask: 6.920, bid: 6.890 },
    to: { ask: 6.712, bid: 6.683 },
    ticks: 60,
  }),
});
```

- [ ] **Step 7: Create stale-then-spike.ts**

```typescript
// src/simulator/scenarios/stale-then-spike.ts

import { defineScenario } from './index.js';
import { stale } from './generators.js';
import type { ScenarioTick } from '../types.js';

const normalTicks: ScenarioTick[] = Array.from({ length: 10 }, () => ({
  ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400,
}));

const spikeTicks: ScenarioTick[] = [
  { ask: 7.200, bid: 7.170, totalAsk: 200, totalBid: 150 },
  { ask: 7.150, bid: 7.120, totalAsk: 300, totalBid: 250 },
  { ask: 7.100, bid: 7.070, totalAsk: 400, totalBid: 350 },
];

export default defineScenario({
  name: 'stale-then-spike',
  description: '10 normal ticks, 12 empty ticks (no data), then a 4% price jump',
  tickIntervalMs: 30_000,
  ticks: [...normalTicks, ...stale(12), ...spikeTicks],
});
```

- [ ] **Step 8: Create thin-book.ts**

```typescript
// src/simulator/scenarios/thin-book.ts

import { defineScenario } from './index.js';
import type { ScenarioTick } from '../types.js';

const ticks: ScenarioTick[] = Array.from({ length: 15 }, (_, i) => ({
  ask: 6.920,
  bid: 6.890,
  totalAsk: Math.max(500 - i * 40, 5),  // 500 → 5
  totalBid: Math.max(400 - i * 30, 5),  // 400 → 5
}));

export default defineScenario({
  name: 'thin-book',
  description: 'Normal prices but totalAsk/totalBid drop to near zero',
  tickIntervalMs: 30_000,
  ticks,
  expect: {
    spreadNeverBelow: 0.015,
  },
});
```

- [ ] **Step 9: Smoke test: list all scenarios**

Run: `npm run simulate -- --list`
Expected: Lists all 8 scenarios with names and descriptions.

- [ ] **Step 10: Smoke test: run a scenario**

Run: `npm run simulate -- --scenario flash-crash-5pct --mode unit`
Expected: Prints timeline table with 25 ticks, assertions results. Exit code depends on assertion outcomes.

- [ ] **Step 11: Commit**

```bash
git add src/simulator/scenarios/
git commit -m "feat(simulator): add 8 built-in stress test scenarios"
```

---

### Task 10: End-to-End Smoke Test

**Files:**
- Test: `tests/simulator/smoke.test.ts`

- [ ] **Step 1: Write end-to-end smoke test**

```typescript
// tests/simulator/smoke.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { runUnit, runIntegration } from '../../src/simulator/engine.js';
import { loadBuiltinScenarios, getScenario, listScenarios } from '../../src/simulator/scenarios/index.js';
import { runAssertions } from '../../src/simulator/output/assertions.js';
import { formatTable } from '../../src/simulator/output/table.js';

beforeAll(async () => {
  await loadBuiltinScenarios();
});

describe('simulator smoke tests', () => {
  it('has all 8 built-in scenarios registered', () => {
    const scenarios = listScenarios();
    expect(scenarios.length).toBe(8);
    expect(scenarios.map((s) => s.name)).toContain('flash-crash-5pct');
    expect(scenarios.map((s) => s.name)).toContain('spread-inversion');
    expect(scenarios.map((s) => s.name)).toContain('oscillation');
  });

  it('runs flash-crash-5pct in unit mode end-to-end', () => {
    const scenario = getScenario('flash-crash-5pct')!;
    const config = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };
    const volConfig = { volatilityThresholdPercent: 2, volatilityWindowMinutes: 5 };

    const result = runUnit(scenario, config, volConfig);

    expect(result.timeline.length).toBe(scenario.ticks.length);
    expect(result.summary.emergencyTriggered).toBe(true); // should trigger on 5% drop

    // Table output should not throw
    const table = formatTable(result);
    expect(table).toContain('flash-crash-5pct');

    // Assertions should pass
    if (scenario.expect) {
      const assertions = runAssertions(result, scenario.expect);
      for (const a of assertions) {
        expect(a.passed).toBe(true);
      }
    }
  });

  it('runs flash-crash-5pct in integration mode end-to-end', async () => {
    const scenario = getScenario('flash-crash-5pct')!;
    const config = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };
    const volConfig = { volatilityThresholdPercent: 2, volatilityWindowMinutes: 5 };

    const result = await runIntegration(scenario, config, volConfig);

    expect(result.mode).toBe('integration');
    expect(result.timeline.length).toBe(scenario.ticks.length);
  });

  it('runs spread-inversion and detects the inversion', () => {
    const scenario = getScenario('spread-inversion')!;
    const config = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };
    const volConfig = { volatilityThresholdPercent: 2, volatilityWindowMinutes: 5 };

    const result = runUnit(scenario, config, volConfig);

    // Should have paused entries where bid > ask
    const pausedTicks = result.timeline.filter((t) => t.paused);
    expect(pausedTicks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the smoke test**

Run: `npx vitest run tests/simulator/smoke.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 3: Run the full test suite to verify nothing is broken**

Run: `npm test`
Expected: All existing tests + new simulator tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/simulator/smoke.test.ts
git commit -m "test(simulator): add end-to-end smoke tests"
```

---

### Task 11: Final CLI Smoke Test & Cleanup

**Files:**
- No new files. Verify everything works end-to-end via CLI.

- [ ] **Step 1: Run list command**

Run: `npm run simulate -- --list`
Expected: All 8 scenarios listed with descriptions.

- [ ] **Step 2: Run unit mode with table output**

Run: `npm run simulate -- --scenario flash-crash-5pct --mode unit`
Expected: Timeline table printed. Assertions section shows results. Exit code based on assertion outcomes.

- [ ] **Step 3: Run integration mode with table output**

Run: `npm run simulate -- --scenario oscillation --mode integration`
Expected: Timeline table printed for 30 ticks. No crash.

- [ ] **Step 4: Run with JSON output**

Run: `npm run simulate -- --scenario spread-squeeze --output json | head -20`
Expected: Valid JSON output.

- [ ] **Step 5: Run with config override**

Run: `npm run simulate -- --scenario flash-crash-5pct --mode unit --config min_spread=0.01,max_spread=0.03`
Expected: Timeline uses overridden config values.

- [ ] **Step 6: Run the full test suite one final time**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 7: Final commit if any adjustments were needed**

```bash
git add -A
git commit -m "chore(simulator): final cleanup and verification"
```
