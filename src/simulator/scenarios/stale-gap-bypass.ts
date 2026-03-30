import { defineScenario } from './index.js';
import { stale } from './generators.js';
import type { ScenarioTick } from '../types.js';

// Test: how big a price jump can slip through after various gap durations?
// The volatility window is 5 min (10 ticks at 30s). After 10+ stale ticks,
// the rolling window is empty and ANY price jump goes undetected.

const baseTicks: ScenarioTick[] = Array.from({ length: 5 }, () => ({
  ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400,
}));

// Gap just under the window (4 min = 8 stale ticks)
// The oldest price snapshot should still be in the window
const shortGapSpike: ScenarioTick[] = [
  { ask: 7.300, bid: 7.270, totalAsk: 200, totalBid: 150 }, // +5.5% jump
  { ask: 7.280, bid: 7.250, totalAsk: 300, totalBid: 250 },
];

// Gap exactly at the window boundary (5 min = 10 stale ticks)
const exactGapSpike: ScenarioTick[] = [
  { ask: 7.300, bid: 7.270, totalAsk: 200, totalBid: 150 }, // +5.5% jump
  { ask: 7.280, bid: 7.250, totalAsk: 300, totalBid: 250 },
];

// Gap over the window (6 min = 12 stale ticks) — window fully cleared
const longGapSpike: ScenarioTick[] = [
  { ask: 7.300, bid: 7.270, totalAsk: 200, totalBid: 150 }, // +5.5% jump
  { ask: 7.280, bid: 7.250, totalAsk: 300, totalBid: 250 },
];

export default defineScenario({
  name: 'stale-gap-bypass',
  description: 'Maps the gap duration vs spike detection boundary — 3 gaps (4/5/6 min) then 5.5% jump',
  tickIntervalMs: 30_000,
  ticks: [
    // Phase 1: baseline (5 ticks = 2.5 min)
    ...baseTicks,
    // Phase 2: short gap (8 stale ticks = 4 min) then spike
    ...stale(8),
    ...shortGapSpike,
    // Phase 3: re-establish baseline (5 ticks)
    ...baseTicks,
    // Phase 4: exact window gap (10 stale ticks = 5 min) then spike
    ...stale(10),
    ...exactGapSpike,
    // Phase 5: re-establish baseline (5 ticks)
    ...baseTicks,
    // Phase 6: long gap (12 stale ticks = 6 min) then spike
    ...stale(12),
    ...longGapSpike,
  ],
  expect: {
    // If the system is safe, emergency SHOULD trigger on the 5.5% jump
    // But we expect it WON'T for the longer gaps — this assertion documents the vulnerability
    emergencyTriggered: true,
  },
});
