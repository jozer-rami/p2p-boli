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
