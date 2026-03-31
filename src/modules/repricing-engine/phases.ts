import type { OrderBookAd } from '../../bybit/types.js';
import type { Side } from '../../event-bus.js';

const THIN_VOLUME_THRESHOLD = 50; // USDT

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Find the 1-indexed rank at which myPrice would sit in the sorted book.
 * Sell ads are sorted ascending (cheapest first).
 * Buy ads are sorted descending (highest first).
 */
export function calculatePosition(ads: OrderBookAd[], myPrice: number, side: Side): number {
  const sorted =
    side === 'sell'
      ? [...ads].sort((a, b) => a.price - b.price)
      : [...ads].sort((a, b) => b.price - a.price);

  // Find the first existing price that myPrice would beat or tie
  for (let i = 0; i < sorted.length; i++) {
    if (side === 'sell') {
      if (myPrice <= sorted[i].price) return i + 1;
    } else {
      if (myPrice >= sorted[i].price) return i + 1;
    }
  }
  return sorted.length + 1;
}

/**
 * Returns bestAsk - bestBid, or null if either side is empty.
 */
export function checkSpread(sellAds: OrderBookAd[], buyAds: OrderBookAd[]): number | null {
  if (sellAds.length === 0 || buyAds.length === 0) return null;

  const bestAsk = Math.min(...sellAds.map((a) => a.price));
  const bestBid = Math.max(...buyAds.map((a) => a.price));

  return round3(bestAsk - bestBid);
}

export interface AssessVolumeResult {
  effectiveTopPrice: number;
  skippedThinTop: boolean;
}

/**
 * If the top position has volume (price × quantity) < THIN_VOLUME_THRESHOLD,
 * skip to the next ad. Returns the effective top price and whether it was skipped.
 */
export function assessVolume(ads: OrderBookAd[], side: Side): AssessVolumeResult {
  const sorted =
    side === 'sell'
      ? [...ads].sort((a, b) => a.price - b.price)
      : [...ads].sort((a, b) => b.price - a.price);

  if (sorted.length === 0) {
    return { effectiveTopPrice: 0, skippedThinTop: false };
  }

  const top = sorted[0];
  const topVolume = top.price * top.quantity;

  if (topVolume < THIN_VOLUME_THRESHOLD && sorted.length > 1) {
    return { effectiveTopPrice: sorted[1].price, skippedThinTop: true };
  }

  return { effectiveTopPrice: top.price, skippedThinTop: false };
}

export interface DetectAggressiveResult {
  excluded: OrderBookAd | null;
  remaining: OrderBookAd[];
}

/**
 * Sort ads by price, then check if the gap between #1 and #2 is > 2× the
 * median of the remaining gaps. If so, exclude #1 as aggressive.
 * Requires at least 3 ads to detect.
 */
export function detectAggressive(ads: OrderBookAd[], side: Side): DetectAggressiveResult {
  if (ads.length < 3) {
    return { excluded: null, remaining: [...ads] };
  }

  const sorted =
    side === 'sell'
      ? [...ads].sort((a, b) => a.price - b.price)
      : [...ads].sort((a, b) => b.price - a.price);

  // Gaps between consecutive ads (always positive)
  const allGaps = sorted.slice(1).map((ad, i) => Math.abs(sorted[i].price - ad.price));

  // Gap between #1 and #2
  const topGap = allGaps[0];

  // Remaining gaps (between #2 onward)
  const remainingGaps = allGaps.slice(1);

  if (remainingGaps.length === 0) {
    return { excluded: null, remaining: [...sorted] };
  }

  const sortedRemainingGaps = [...remainingGaps].sort((a, b) => a - b);
  const mid = Math.floor(sortedRemainingGaps.length / 2);
  const median =
    sortedRemainingGaps.length % 2 !== 0
      ? sortedRemainingGaps[mid]
      : (sortedRemainingGaps[mid - 1] + sortedRemainingGaps[mid]) / 2;

  if (topGap > 2 * median) {
    return { excluded: sorted[0], remaining: sorted.slice(1) };
  }

  return { excluded: null, remaining: [...sorted] };
}

/**
 * Calculate the optimal price for the given side and target position.
 * Conservative (target #3): match the #3 position. If fewer competitors, match #1.
 * For sell: undercut by 0.001. For buy: outbid by 0.001.
 * Rounded to 3 decimals.
 */
export function calculateOptimalPrice(ads: OrderBookAd[], side: Side, targetPosition: number): number {
  const sorted =
    side === 'sell'
      ? [...ads].sort((a, b) => a.price - b.price)
      : [...ads].sort((a, b) => b.price - a.price);

  // If fewer competitors than target, fall back to position 1
  const index = sorted.length >= targetPosition ? targetPosition - 1 : 0;
  const referencePrice = sorted[index].price;

  if (side === 'sell') {
    return round3(referencePrice - 0.001);
  } else {
    return round3(referencePrice + 0.001);
  }
}

export interface SafetyBoundsResult {
  buyPrice: number;
  sellPrice: number;
}

/**
 * Widen or narrow the spread to fit within [minSpread, maxSpread].
 * Adjusts symmetrically around the midpoint. Rounded to 3 decimals.
 */
export function applySafetyBounds(
  buyPrice: number,
  sellPrice: number,
  minSpread: number,
  maxSpread: number,
): SafetyBoundsResult {
  const spread = sellPrice - buyPrice;
  const mid = (sellPrice + buyPrice) / 2;

  if (spread < minSpread) {
    return {
      buyPrice: round3(mid - minSpread / 2),
      sellPrice: round3(mid + minSpread / 2),
    };
  }

  if (spread > maxSpread) {
    return {
      buyPrice: round3(mid - maxSpread / 2),
      sellPrice: round3(mid + maxSpread / 2),
    };
  }

  return {
    buyPrice: round3(buyPrice),
    sellPrice: round3(sellPrice),
  };
}

/**
 * Anti-oscillation guard.
 * Returns true (hold) if both price changes are strictly below the threshold.
 * Returns false (reprice) if current prices are null (first run) or a change
 * meets or exceeds the threshold.
 */
export function checkAntiOscillation(
  newBuy: number,
  newSell: number,
  currentBuy: number | null,
  currentSell: number | null,
  threshold: number,
): boolean {
  // First run — always reprice
  if (currentBuy === null || currentSell === null) return false;

  const buyChange = Math.abs(newBuy - currentBuy);
  const sellChange = Math.abs(newSell - currentSell);

  return buyChange < threshold && sellChange < threshold;
}
