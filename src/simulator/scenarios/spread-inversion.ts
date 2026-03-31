import { defineScenario } from './index.js';
import type { ScenarioTick } from '../types.js';

const ticks: ScenarioTick[] = [
  { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 500 },
  { ask: 6.910, bid: 6.900, totalAsk: 500, totalBid: 500 },
  { ask: 6.900, bid: 6.910, totalAsk: 500, totalBid: 500 },
  { ask: 6.890, bid: 6.920, totalAsk: 500, totalBid: 500 },
];

export default defineScenario({
  name: 'spread-inversion',
  description: 'Bid crosses above ask over 3 ticks — P2P inversion is a profit opportunity',
  tickIntervalMs: 30_000,
  ticks,
  expect: {
    // In P2P, inversions are profitable — bot should keep trading, not emergency stop
    emergencyTriggered: false,
    spreadNeverBelow: 0.015,
  },
});
