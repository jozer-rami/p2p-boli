import { defineScenario } from './index.js';
import { linearDrop } from './generators.js';

export default defineScenario({
  name: 'slow-drift',
  description: '3% drop over 60 ticks (30 min simulated) — just under volatility threshold',
  tickIntervalMs: 30_000,
  ticks: linearDrop({
    from: { ask: 6.920, bid: 6.890 },
    to: { ask: 6.712, bid: 6.683 },
    ticks: 60,
  }),
});
