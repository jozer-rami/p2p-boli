import { defineScenario } from './index.js';
import { spreadSqueeze } from './generators.js';

export default defineScenario({
  name: 'spread-squeeze',
  description: 'Ask and bid converge until spread drops below min_spread',
  tickIntervalMs: 30_000,
  ticks: spreadSqueeze({
    start: { ask: 6.920, bid: 6.880 },
    endSpread: 0.005,
    ticks: 20,
  }),
});
