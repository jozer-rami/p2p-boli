import { defineScenario } from './index.js';
import type { ScenarioTick } from '../types.js';

const ticks: ScenarioTick[] = Array.from({ length: 15 }, (_, i) => ({
  ask: 6.920,
  bid: 6.890,
  totalAsk: Math.max(500 - i * 40, 5),
  totalBid: Math.max(400 - i * 30, 5),
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
