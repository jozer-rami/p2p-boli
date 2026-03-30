# Volatility Guards — Gap, Depth & Session Drift Protection

**Date**: 2026-03-30
**Status**: Approved

## Overview

Three new safety guards in PriceMonitor that address vulnerabilities discovered via the simulator: data gap bypass, thin order book blindness, and staircase price evasion. All guards are config-gated and disabled by default.

## Motivation

The price replay simulator revealed three scenarios where the bot continues trading when it shouldn't:

1. **Gap bypass**: A data outage lasting >= the volatility window (5 min) clears the rolling price history. Any price jump after the gap goes undetected.
2. **Thin book blindness**: The bot keeps ads active when order book depth drops to near-zero. Fills on a thin book carry extreme slippage risk.
3. **Staircase evasion**: Alternating small gaps with sub-threshold price steps moves the price 4%+ without ever triggering the rolling window check.

## Goals

- Close all three vulnerability gaps with targeted guards
- Zero behavioral change when guards are disabled (opt-in via config)
- Follow existing patterns: guards emit events, EmergencyStop reacts
- Simulator updated to verify guards work against the diagnostic scenarios

## Non-Goals

- No changes to the existing rolling window volatility check
- No auto-recording of price data
- No UI/dashboard changes

---

## Config Keys

Six new entries in `DEFAULT_CONFIG`, all disabled by default:

| Key | Default | Purpose |
|---|---|---|
| `gap_guard_enabled` | `'false'` | Enable gap price comparison on data resume |
| `gap_guard_threshold_percent` | `'2'` | Max allowed price jump after a data gap |
| `depth_guard_enabled` | `'false'` | Enable order book depth monitoring |
| `depth_guard_min_usdt` | `'100'` | Minimum totalAsk/totalBid to keep ads active |
| `session_drift_guard_enabled` | `'false'` | Enable session base price drift tracking |
| `session_drift_threshold_percent` | `'3'` | Max allowed drift from session start price |

Read at startup from the config table, same pattern as existing config values. Passed to PriceMonitor via its config interface.

---

## New Events

Three new events added to `EventMap` in `src/event-bus.ts`:

```typescript
'price:gap-alert': {
  lastKnownPrice: number;
  resumePrice: number;
  changePercent: number;
  gapDurationSeconds: number;
}

'price:low-depth': {
  totalAsk: number;
  totalBid: number;
  minRequired: number;
}

'price:session-drift': {
  sessionBasePrice: number;
  currentPrice: number;
  driftPercent: number;
}
```

---

## Guard Implementations

All three guards live in PriceMonitor, running during the `fetchOnce()` flow.

### Gap Guard

**State:**
- `lastKnownPrice: number | null` — updated every time valid prices arrive (bid > 0)
- `lastSuccessfulFetch: number` — timestamp (ms) of last valid price fetch

**Logic** (runs when valid prices arrive):
1. If `lastKnownPrice` exists AND time since `lastSuccessfulFetch` exceeds `volatilityWindowMinutes * 60 * 1000` (the rolling window duration):
   - Compute `changePercent = |currentBid - lastKnownPrice| / lastKnownPrice * 100`
   - If `changePercent > gap_guard_threshold_percent`: emit `price:gap-alert`
2. Update `lastKnownPrice = currentBid`
3. Update `lastSuccessfulFetch = now`

**Rationale**: Within the volatility window, the existing rolling window check catches price jumps. The gap guard only activates when the gap is long enough that the rolling window has been fully cleared — exactly the blind spot.

### Depth Guard

**State:** None — purely reactive per tick.

**Logic** (runs after Bybit prices are fetched):
1. Get the Bybit platform prices (the ones the bot's ads compete against)
2. If `totalAsk < depth_guard_min_usdt` OR `totalBid < depth_guard_min_usdt`: emit `price:low-depth`

**Rationale**: Only checks Bybit P2P depth, not CriptoYa aggregates. CriptoYa prices are reference data; Bybit is where the bot's ads live.

### Session Drift Guard

**State:**
- `sessionBasePrice: number | null` — set on the first valid bid received after startup or emergency resolution. Never updated automatically during normal operation.

**Logic** (runs when valid prices arrive):
1. If `sessionBasePrice` is null: set `sessionBasePrice = currentBid`, return
2. Compute `driftPercent = |currentBid - sessionBasePrice| / sessionBasePrice * 100`
3. If `driftPercent > session_drift_threshold_percent`: emit `price:session-drift`

**Session base reset**: PriceMonitor listens for `emergency:resolved`. On resolve, sets `sessionBasePrice = null` so it picks up the new market level on the next valid price fetch. This prevents the guard from immediately re-triggering after manual resume.

---

## EmergencyStop Integration

Three new event subscriptions in EmergencyStop, same pattern as the existing `price:volatility-alert` listener:

```typescript
bus.on('price:gap-alert', (payload) =>
  this.trigger('gap_alert', `Price jumped ${payload.changePercent.toFixed(1)}% after ${payload.gapDurationSeconds}s data gap`));

bus.on('price:low-depth', (payload) =>
  this.trigger('low_depth', `Order book depth ${Math.min(payload.totalAsk, payload.totalBid)} USDT below minimum ${payload.minRequired}`));

bus.on('price:session-drift', (payload) =>
  this.trigger('session_drift', `Price drifted ${payload.driftPercent.toFixed(1)}% from session start`));
```

The `EmergencyTrigger` type union gains three new values: `'gap_alert' | 'low_depth' | 'session_drift'`.

---

## PriceMonitor Config Interface Changes

The `PriceMonitorConfig` interface gains six new optional fields:

```typescript
export interface PriceMonitorConfig {
  // Existing
  volatilityThresholdPercent: number;
  volatilityWindowMinutes: number;
  // New — gap guard
  gapGuardEnabled?: boolean;
  gapGuardThresholdPercent?: number;
  // New — depth guard
  depthGuardEnabled?: boolean;
  depthGuardMinUsdt?: number;
  // New — session drift guard
  sessionDriftGuardEnabled?: boolean;
  sessionDriftThresholdPercent?: number;
}
```

Optional with defaults so existing callers (tests, simulator) don't break.

---

## Simulator Updates

### Unit Mode Engine

The unit mode engine in `src/simulator/engine.ts` gains the three guards mirrored inline (same approach as existing volatility and spread inversion checks):

- **Gap guard**: track `lastKnownPrice` and `lastValidTickTime`. When a valid tick arrives after a gap exceeding the volatility window, check the price jump.
- **Depth guard**: check `totalAsk`/`totalBid` against `depth_guard_min_usdt`.
- **Session drift guard**: track `sessionBasePrice`, compare each tick.

All three gated by their respective config flags, reading from the config overrides.

### Config Override Support

The CLI `--config` flag already supports arbitrary key=value pairs. The guards are exercised by passing their config:

```bash
npm run simulate -- --scenario repeated-micro-gaps --mode unit \
  --config session_drift_guard_enabled=true,session_drift_threshold_percent=3

npm run simulate -- --scenario stale-gap-bypass --mode unit \
  --config gap_guard_enabled=true,gap_guard_threshold_percent=2

npm run simulate -- --scenario thin-book-crash --mode unit \
  --config depth_guard_enabled=true,depth_guard_min_usdt=100
```

### Updated Diagnostic Scenario Assertions

The three diagnostic scenarios keep their current assertions (which document the vulnerabilities when guards are off). New assertions are NOT added to the scenarios — the scenarios document baseline behavior. Guards are tested by running with `--config` overrides.

---

## Wiring in src/index.ts

Read the six new config keys at startup and pass them to PriceMonitor:

```typescript
const gapGuardEnabled = (await getConfig('gap_guard_enabled')) === 'true';
const gapGuardThresholdPercent = parseFloat(await getConfig('gap_guard_threshold_percent'));
const depthGuardEnabled = (await getConfig('depth_guard_enabled')) === 'true';
const depthGuardMinUsdt = parseFloat(await getConfig('depth_guard_min_usdt'));
const sessionDriftGuardEnabled = (await getConfig('session_drift_guard_enabled')) === 'true';
const sessionDriftThresholdPercent = parseFloat(await getConfig('session_drift_threshold_percent'));

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

---

## Files Changed

| File | Change |
|---|---|
| `src/config.ts` | Add 6 new DEFAULT_CONFIG entries |
| `src/event-bus.ts` | Add 3 new events to EventMap |
| `src/modules/price-monitor/index.ts` | Add 3 guards to fetchOnce() flow, listen for emergency:resolved |
| `src/modules/emergency-stop/index.ts` | Add 3 new event subscriptions, extend EmergencyTrigger type |
| `src/index.ts` | Read 6 new config keys, pass to PriceMonitor |
| `src/simulator/engine.ts` | Mirror 3 guards in unit mode, parse new config overrides |
| `tests/modules/price-monitor/` | Tests for each guard |
| `tests/modules/emergency-stop/` | Tests for new triggers |
| `tests/simulator/` | Tests verifying guards in simulator |
