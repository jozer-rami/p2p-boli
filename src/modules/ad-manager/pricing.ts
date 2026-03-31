import type { PlatformPrices } from '../../event-bus.js';
import type { PricingConfig, PricingResult } from './types.js';

/** Round to 3 decimal places — Bybit BOB precision limit */
function round3(n: number): number {
  return Math.round(n * 1_000) / 1_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function calculatePricing(
  prices: PlatformPrices[],
  config: PricingConfig,
): PricingResult {
  // Filter to entries where both ask and bid are positive
  const valid = prices.filter((p) => p.ask > 0 && p.bid > 0);

  if (valid.length === 0) {
    return {
      buyPrice: 0,
      sellPrice: 0,
      spread: 0,
      paused: { buy: true, sell: true, reason: 'no valid market prices' },
    };
  }

  // Prefer Bybit P2P prices; fall back to average of all valid entries
  const bybit = valid.find((p) => p.platform === 'bybitp2p');
  let ask: number;
  let bid: number;

  if (bybit) {
    ask = bybit.ask;
    bid = bybit.bid;
  } else {
    ask = valid.reduce((sum, p) => sum + p.ask, 0) / valid.length;
    bid = valid.reduce((sum, p) => sum + p.bid, 0) / valid.length;
  }

  const mid = (ask + bid) / 2;
  // In P2P, bid > ask (inversion) is a profit opportunity.
  // Use absolute spread to measure available room.
  const marketSpread = Math.abs(ask - bid);
  const targetSpread = clamp(marketSpread, config.minSpread, config.maxSpread);

  const buyPrice = round3(mid - targetSpread / 2);
  const sellPrice = round3(mid + targetSpread / 2);

  if (buyPrice >= sellPrice) {
    return {
      buyPrice,
      sellPrice,
      spread: 0,
      paused: { buy: true, sell: true, reason: 'spread inversion' },
    };
  }

  return {
    buyPrice,
    sellPrice,
    spread: round3(sellPrice - buyPrice),
    paused: { buy: false, sell: false },
  };
}
