import type { OrderBookAd } from '../../bybit/types.js';
import type { OrderBookFilters } from './types.js';

const PRICE_FLOOR = 8;
const PRICE_CEILING = 12;

export function applyFilters(
  ads: OrderBookAd[],
  filters: OrderBookFilters,
  selfUserId: string,
): OrderBookAd[] {
  return ads.filter((ad) => {
    if (ad.userId === selfUserId) return false;
    if (ad.price < PRICE_FLOOR || ad.price > PRICE_CEILING) return false;
    if (ad.maxAmount < filters.minOrderAmount) return false;
    if (filters.verifiedOnly && ad.authStatus !== 2) return false;
    if (ad.recentExecuteRate < filters.minCompletionRate) return false;
    if (ad.recentOrderNum < filters.minOrderCount) return false;
    if (filters.merchantLevels.length > 0) {
      const hasMatchingTag = ad.authTag.some((tag) => filters.merchantLevels.includes(tag));
      if (!hasMatchingTag) return false;
    }
    return true;
  });
}
