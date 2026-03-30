import { defineScenario } from './index.js';
import type { ScenarioTick } from '../types.js';

// Test: what happens when liquidity thins out AND price starts moving?
// The bot keeps ads active at the same price even when the book has 5 USDT depth.
// If someone fills that thin ad, the price could have already moved against us.

// Phase 1: Normal book, stable price (5 ticks)
// Phase 2: Book thins while price is stable (10 ticks) — bot stays active
// Phase 3: Price starts moving while book is thin (10 ticks) — bot reprices but
//          is exposed because any fill at these prices has no depth backing it
// Phase 4: Price drops 3% on thin book (5 ticks) — just under volatility threshold
//          but on a book with 5 USDT depth, this is extremely dangerous

const ticks: ScenarioTick[] = [
  // Phase 1: healthy book
  { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
  { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
  { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
  { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
  { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },

  // Phase 2: book thins, price steady — bot doesn't notice
  { ask: 6.920, bid: 6.890, totalAsk: 300, totalBid: 250 },
  { ask: 6.920, bid: 6.890, totalAsk: 200, totalBid: 150 },
  { ask: 6.920, bid: 6.890, totalAsk: 100, totalBid: 80 },
  { ask: 6.920, bid: 6.890, totalAsk: 50, totalBid: 40 },
  { ask: 6.920, bid: 6.890, totalAsk: 20, totalBid: 15 },
  { ask: 6.920, bid: 6.890, totalAsk: 10, totalBid: 8 },
  { ask: 6.920, bid: 6.890, totalAsk: 5, totalBid: 5 },
  { ask: 6.920, bid: 6.890, totalAsk: 5, totalBid: 5 },
  { ask: 6.920, bid: 6.890, totalAsk: 5, totalBid: 5 },
  { ask: 6.920, bid: 6.890, totalAsk: 5, totalBid: 5 },

  // Phase 3: price drifts down on thin book — bot reprices into the void
  { ask: 6.910, bid: 6.880, totalAsk: 5, totalBid: 5 },
  { ask: 6.900, bid: 6.870, totalAsk: 5, totalBid: 5 },
  { ask: 6.885, bid: 6.855, totalAsk: 5, totalBid: 5 },
  { ask: 6.870, bid: 6.840, totalAsk: 5, totalBid: 5 },
  { ask: 6.855, bid: 6.825, totalAsk: 5, totalBid: 5 },
  { ask: 6.840, bid: 6.810, totalAsk: 5, totalBid: 5 },
  { ask: 6.825, bid: 6.795, totalAsk: 5, totalBid: 5 },
  { ask: 6.810, bid: 6.780, totalAsk: 5, totalBid: 5 },
  { ask: 6.795, bid: 6.765, totalAsk: 3, totalBid: 3 },
  { ask: 6.780, bid: 6.750, totalAsk: 3, totalBid: 3 },

  // Phase 4: sudden 1.5% drop on empty book — not enough to trigger volatility
  //          but extremely risky because there's no depth
  { ask: 6.680, bid: 6.650, totalAsk: 3, totalBid: 3 },
  { ask: 6.650, bid: 6.620, totalAsk: 3, totalBid: 3 },
];

export default defineScenario({
  name: 'thin-book-crash',
  description: 'Liquidity drains then price drops — bot stays active on empty book',
  tickIntervalMs: 30_000,
  ticks,
});
