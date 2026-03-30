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
  description: 'Bid crosses above ask over 3 ticks',
  tickIntervalMs: 30_000,
  ticks,
  expect: {
    emergencyTriggered: true,
  },
});
