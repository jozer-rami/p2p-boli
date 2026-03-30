# Price Replay & Stress Test Simulator

**Date**: 2026-03-29
**Status**: Approved

## Overview

A standalone CLI tool (`npm run simulate`) that replays historical or synthetic price sequences through the bot's decision layers, producing decision timelines and pass/fail assertions. Tests that the pricing, spread management, and emergency stop logic behave correctly under volatility.

## Goals

- Verify the system handles real-world volatility moments correctly by replaying historical ask/bid data
- Stress test edge cases (flash crashes, spread inversions, stale data) with synthetic scenarios
- Provide both automated assertions (CI-friendly) and human-readable timelines for exploratory analysis
- Zero changes to production modules — all injection through existing dependency interfaces

## Non-Goals

- No auto-recording of live price data (user imports/sources data externally)
- No Telegram integration for triggering simulations
- Not a vitest test suite — standalone CLI tool

---

## Scenario Format

Scenarios are the input: a sequence of price ticks with metadata. Two definition methods:

### JSON Files (imported historical data)

```json
{
  "name": "march-2026-flash-crash",
  "description": "BOB/USDT dropped 4% in 90 seconds on March 15",
  "source": "criptoya-export",
  "tickIntervalMs": 30000,
  "ticks": [
    { "ask": 6.920, "bid": 6.890, "totalAsk": 500, "totalBid": 400 },
    { "ask": 6.910, "bid": 6.875, "totalAsk": 300, "totalBid": 200 },
    { "ask": 6.850, "bid": 6.800, "totalAsk": 100, "totalBid": 50 }
  ]
}
```

### TypeScript Generators (synthetic stress scenarios)

```typescript
export const flashCrash = defineScenario({
  name: 'flash-crash-5pct',
  description: 'Price drops 5% over 10 ticks then recovers',
  tickIntervalMs: 30_000,
  ticks: [
    ...linearDrop({ from: { ask: 6.92, bid: 6.89 }, to: { ask: 6.57, bid: 6.54 }, ticks: 10 }),
    ...linearRecover({ from: { ask: 6.57, bid: 6.54 }, to: { ask: 6.90, bid: 6.87 }, ticks: 15 }),
  ],
});
```

### Tick Schema

Each tick represents one price snapshot (what PriceMonitor would have fetched):

```typescript
interface ScenarioTick {
  ask: number;       // Lowest sell price in market
  bid: number;       // Highest buy price in market
  totalAsk: number;  // Volume available at ask
  totalBid: number;  // Volume available at bid
}
```

- `tickIntervalMs` maps to simulated time between ticks (default: 30,000ms, matching real poll interval)
- Scenarios live in `src/simulator/scenarios/` as JSON or TS files

### Generator Helpers

Composable functions for building synthetic scenarios:

| Helper | Purpose |
|--------|---------|
| `linearDrop(from, to, ticks)` | Linear price decline |
| `linearRecover(from, to, ticks)` | Linear price recovery |
| `oscillate(center, amplitude, period, ticks)` | Sinusoidal price swings |
| `spreadSqueeze(start, minSpread, ticks)` | Ask/bid converge gradually |
| `stale(ticks)` | Empty ticks (no data) to simulate feed outage |

---

## Simulation Engine

### SimulatedClock

Replaces `Date.now()` for all modules during simulation. Advances deterministically per tick based on `tickIntervalMs`. Ensures reproducible results regardless of real wall-clock time.

### Unit Mode (`--mode unit`)

- Feeds ticks directly into `calculatePricing()` and the volatility detection logic
- No EventBus, no modules instantiated
- Per-tick output: `{ tick, buyPrice, sellPrice, spread, paused, volatilityAlert }`
- Runs in milliseconds — for iterating on pricing logic and testing hundreds of scenarios

### Integration Mode (`--mode integration`, default)

- Boots real modules: PriceMonitor, AdManager, EmergencyStop
- **ReplayPriceSource**: replaces CriptoYa/Bybit fetch — returns the next tick from the scenario
- **MockBybitClient**: tracks ad state in memory (created, repriced, removed) without hitting API
- **SilentTelegramClient**: captures alert messages but does not send
- **EventBus**: real instance — every event emission captured into the timeline
- Each tick: clock advances -> PriceMonitor processes tick -> AdManager reacts -> EmergencyStop evaluates -> all events recorded

### Architecture Diagram

```
CLI (npm run simulate)
 +-- loads scenario file
 +-- selects mode (unit / integration)
      |
      +-- Unit Mode
      |   +-- for each tick:
      |       +-- calculatePricing(tick)
      |       +-- volatilityCheck(tick, clock)
      |       -> append to results[]
      |
      +-- Integration Mode
          +-- SimulatedClock
          +-- ReplayPriceSource (feeds ticks)
          +-- MockBybitClient (tracks ads in memory)
          +-- SilentTelegramClient
          +-- Real: PriceMonitor, AdManager, EmergencyStop
          +-- EventBus (captures timeline)
          -> for each tick: advance clock, trigger fetch, collect events
```

### Key Principle

No changes to production modules. The simulator injects mock dependencies through the same interfaces the real bot uses. PriceMonitor already takes a client — we give it a replay client instead.

---

## CLI Interface

### Commands

```bash
# Replay historical data (defaults to integration mode)
npm run simulate -- --file data/snapshots/march-crash.json

# Unit mode for fast pricing-only analysis
npm run simulate -- --file data/snapshots/march-crash.json --mode unit

# Run a built-in synthetic scenario
npm run simulate -- --scenario flash-crash-5pct

# List available built-in scenarios
npm run simulate -- --list

# Override config for a run
npm run simulate -- --scenario flash-crash-5pct --config min_spread=0.01,max_spread=0.03

# JSON output for programmatic use
npm run simulate -- --scenario flash-crash-5pct --output json > results.json

# Skip assertions, just show timeline
npm run simulate -- --scenario flash-crash-5pct --no-assert
```

### Exit Codes

- `0` — simulation completed, all assertions passed (or no assertions)
- `1` — one or more assertions failed
- `2` — invalid input (bad file path, malformed scenario, unknown scenario name)

---

## Output

### Timeline Table (stdout, default)

```
+------+----------+-------+-------+--------+-----------+------------+-------------------------+
| Tick | Time     | Ask   | Bid   | Spread | Buy Price | Sell Price | Events                  |
+------+----------+-------+-------+--------+-----------+------------+-------------------------+
|    1 | 00:00:00 | 6.920 | 6.890 | 0.030  | 6.890     | 6.920      | ad:created(buy,sell)     |
|    2 | 00:00:30 | 6.910 | 6.875 | 0.035  | 6.875     | 6.910      | ad:repriced(buy,sell)    |
|    3 | 00:01:00 | 6.850 | 6.800 | 0.050  | 6.800     | 6.850      | ad:repriced(buy,sell)    |
|    4 | 00:01:30 | 6.780 | 6.720 | 0.060  | 6.745     | 6.795      | ad:repriced (clamped)    |
|    5 | 00:02:00 | 6.700 | 6.640 | 0.060  | --        | --         | volatility-alert(3.6%)  |
|    6 | 00:02:30 | 6.700 | 6.640 | --     | --        | --         | emergency:triggered     |
+------+----------+-------+-------+--------+-----------+------------+-------------------------+

Summary:
  Ticks: 6 | Duration: 2m30s (simulated)
  Reprices: 3 | Pauses: 0 | Emergency: YES (tick 6, volatility)
  Max spread: 0.060 | Min spread: 0.030
  Exit: EMERGENCY at tick 6
```

### JSON Output (`--output json`)

Full timeline with every event, pricing decision, and module state per tick. For piping into analysis scripts.

---

## Assertions

Optional `expect` block per scenario for pass/fail verification:

```typescript
export const flashCrash = defineScenario({
  name: 'flash-crash-5pct',
  ticks: [...],
  expect: {
    emergencyTriggered: true,
    emergencyByTick: 12,
    maxRepricesBeforeEmergency: 5,
    noAdsActiveDuring: [6, 15],
    spreadNeverBelow: 0.015,
  }
});
```

### Available Assertions

| Assertion | Description |
|-----------|-------------|
| `emergencyTriggered` | Whether emergency stop should fire |
| `emergencyByTick` | Emergency must trigger no later than this tick |
| `maxRepricesBeforeEmergency` | Cap on repricing thrash before stopping |
| `noAdsActiveDuring` | Tick range where all ads must be removed |
| `spreadNeverBelow` | Bot should never post ads below this spread |

### CLI Output with Assertions

```
  ✓ Emergency triggered: yes (tick 5)
  ✓ Emergency by tick 12: passed (actual: tick 5)
  ✓ Max reprices before emergency: 3 <= 5
  ✓ No ads active during ticks 6-15: passed
  ✓ Spread never below 0.015: passed

  5/5 assertions passed
```

When running without assertions (historical replay with no `expect` block), just the timeline and summary are printed.

---

## Built-in Synthetic Scenarios

| Scenario | Description | What It Tests |
|----------|-------------|---------------|
| `flash-crash-5pct` | 5% drop over 10 ticks, recovery over 15 | Volatility detection timing, emergency trigger, recovery behavior |
| `flash-crash-10pct` | 10% drop over 5 ticks, no recovery | Extreme crash — does emergency fire fast enough? |
| `spread-squeeze` | Ask and bid converge until spread < min_spread | Pause logic when spread becomes unprofitable |
| `spread-inversion` | Bid crosses above ask over 3 ticks | Inversion detection and emergency trigger |
| `oscillation` | Price swings +/-1.5% every 4 ticks for 30 ticks | Repricing frequency — does the bot thrash or stay stable? |
| `slow-drift` | 3% drop over 60 ticks (30 min simulated) | Gradual decline that stays just under volatility threshold |
| `stale-then-spike` | 10 normal ticks, 12 empty ticks, then 4% jump | Stale data detection, then recovery under changed conditions |
| `thin-book` | Normal prices but totalAsk/totalBid near zero | How the system handles low liquidity |

Scenarios are composable — e.g., `spreadSqueeze` followed by `flashCrash`.

---

## File Structure

```
src/simulator/
  index.ts              # CLI entry point, arg parsing
  engine.ts             # SimulatedClock, unit runner, integration runner
  types.ts              # Scenario, Tick, Assertion, TimelineEntry types
  mocks/
    replay-price-source.ts   # Feeds ticks as PlatformPrices
    mock-bybit-client.ts     # Tracks ad state in memory
    silent-telegram.ts       # Captures messages without sending
  scenarios/
    index.ts                 # Registry + list command
    generators.ts            # linearDrop, oscillate, spreadSqueeze, etc.
    flash-crash-5pct.ts
    flash-crash-10pct.ts
    spread-squeeze.ts
    spread-inversion.ts
    oscillation.ts
    slow-drift.ts
    stale-then-spike.ts
    thin-book.ts
  output/
    table.ts                 # Timeline table formatter
    json.ts                  # JSON output formatter
    assertions.ts            # Assertion runner + reporter
```

`package.json` addition:
```json
{
  "scripts": {
    "simulate": "tsx src/simulator/index.ts"
  }
}
```
