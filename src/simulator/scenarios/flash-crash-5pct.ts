import { defineScenario } from './index.js';
import { linearDrop, linearRecover } from './generators.js';

export default defineScenario({
  name: 'flash-crash-5pct',
  description: 'Price drops 5% over 10 ticks then recovers over 15',
  tickIntervalMs: 30_000,
  ticks: [
    ...linearDrop({
      from: { ask: 6.920, bid: 6.890 },
      to: { ask: 6.574, bid: 6.546 },
      ticks: 10,
    }),
    ...linearRecover({
      from: { ask: 6.574, bid: 6.546 },
      to: { ask: 6.900, bid: 6.870 },
      ticks: 15,
    }),
  ],
  expect: {
    emergencyTriggered: true,
    emergencyByTick: 12,
    spreadNeverBelow: 0.015,
  },
});
