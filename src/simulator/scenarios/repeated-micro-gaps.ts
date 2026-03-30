import { defineScenario } from './index.js';
import { stale } from './generators.js';
import type { ScenarioTick } from '../types.js';

// Test: can an attacker (or natural market behavior) staircase the price
// by alternating small gaps with small jumps, each under the threshold?
//
// Pattern: 3 ticks at price X → 4 stale ticks → resume at X+0.8% → repeat
// Each step is under 2%, and the gap clears part of the rolling window.
// Over 5 steps this moves the price 4% without ever triggering volatility.

function priceBlock(ask: number, bid: number, count: number): ScenarioTick[] {
  return Array.from({ length: count }, () => ({
    ask, bid, totalAsk: 500, totalBid: 400,
  }));
}

export default defineScenario({
  name: 'repeated-micro-gaps',
  description: 'Staircase: alternating 2-min gaps with 0.8% jumps — evades rolling window',
  tickIntervalMs: 30_000,
  ticks: [
    // Step 0: baseline
    ...priceBlock(6.920, 6.890, 3),
    ...stale(4), // 2 min gap

    // Step 1: +0.8% jump (under 2% threshold)
    ...priceBlock(6.975, 6.945, 3),
    ...stale(4),

    // Step 2: another +0.8%
    ...priceBlock(7.031, 7.001, 3),
    ...stale(4),

    // Step 3: another +0.8%
    ...priceBlock(7.087, 7.057, 3),
    ...stale(4),

    // Step 4: another +0.8%
    ...priceBlock(7.144, 7.114, 3),
    ...stale(4),

    // Step 5: another +0.8% — total: ~4.0% from baseline
    ...priceBlock(7.201, 7.171, 3),
  ],
  expect: {
    // This SHOULD trigger emergency (4% total move) but won't — documents the evasion
    emergencyTriggered: true,
  },
});
