import { defineScenario } from './index.js';
import { oscillate } from './generators.js';

export default defineScenario({
  name: 'oscillation',
  description: 'Price swings +/-1.5% every 4 ticks for 30 ticks',
  tickIntervalMs: 30_000,
  ticks: oscillate({
    center: { ask: 6.920, bid: 6.890 },
    amplitude: 0.104,
    period: 4,
    ticks: 30,
  }),
  expect: {
    spreadNeverBelow: 0.015,
  },
});
