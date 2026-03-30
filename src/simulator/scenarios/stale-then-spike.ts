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
