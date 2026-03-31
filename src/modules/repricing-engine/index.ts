import type { OrderBookAd } from '../../bybit/types.js';
import type { Side } from '../../event-bus.js';
import {
  type RepricingConfig,
  type RepricingResult,
  type CurrentAdPrices,
  type PhaseTrace,
  MODE_PRESETS,
} from './types.js';
import { applyFilters } from './filters.js';
import {
  calculatePosition,
  checkSpread,
  assessVolume,
  detectAggressive,
  calculateOptimalPrice,
  applySafetyBounds,
  checkAntiOscillation,
} from './phases.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('repricing-engine');

export class RepricingEngine {
  private config: RepricingConfig;
  private readonly fetchOrderBook: () => Promise<{ sell: OrderBookAd[]; buy: OrderBookAd[] }>;
  private lastResult: RepricingResult | null = null;
  private filteredSell: OrderBookAd[] = [];
  private filteredBuy: OrderBookAd[] = [];

  constructor(
    config: RepricingConfig,
    fetchOrderBook: () => Promise<{ sell: OrderBookAd[]; buy: OrderBookAd[] }>,
  ) {
    this.config = { ...config };
    this.fetchOrderBook = fetchOrderBook;
  }

  async reprice(currentPrices: CurrentAdPrices): Promise<RepricingResult> {
    const phases: PhaseTrace[] = [];
    const excludedAggressive: Array<{ side: Side; nickName: string; price: number; gap: number }> = [];

    const trace = (phase: number, name: string, result: string, start: number): void => {
      phases.push({ phase, name, result, durationMs: Date.now() - start });
    };

    // ── Phase 1: FETCH ──────────────────────────────────────────────────────
    let rawSell: OrderBookAd[] = [];
    let rawBuy: OrderBookAd[] = [];
    {
      const t = Date.now();
      try {
        const book = await this.fetchOrderBook();
        rawSell = book.sell;
        rawBuy = book.buy;
        trace(1, 'FETCH', `sell=${rawSell.length} buy=${rawBuy.length}`, t);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        trace(1, 'FETCH', `error: ${msg}`, t);
        return this.holdResult(`fetch failed: ${msg}`, phases, excludedAggressive);
      }
    }

    // ── Phase 2: FILTER ─────────────────────────────────────────────────────
    {
      const t = Date.now();
      const filteredSell = applyFilters(rawSell, this.config.filters, this.config.selfUserId);
      const filteredBuy = applyFilters(rawBuy, this.config.filters, this.config.selfUserId);

      this.filteredSell = filteredSell;
      this.filteredBuy = filteredBuy;

      trace(2, 'FILTER', `sell=${filteredSell.length} buy=${filteredBuy.length}`, t);

      if (filteredSell.length === 0 || filteredBuy.length === 0) {
        return this.holdResult('filtered book is empty', phases, excludedAggressive);
      }
    }

    // ── Phase 3: SPREAD ─────────────────────────────────────────────────────
    // Check market spread: null or below minSpread triggers pause.
    // In P2P, bid > ask (negative spread) is an inversion = profit opportunity,
    // not a problem. Use absolute spread to measure available room.
    {
      const t = Date.now();
      const rawSpread = checkSpread(this.filteredSell, this.filteredBuy);
      const effectiveSpread = rawSpread !== null ? Math.abs(rawSpread) : null;
      const inverted = rawSpread !== null && rawSpread < 0;

      if (effectiveSpread === null || effectiveSpread < this.config.minSpread) {
        trace(3, 'SPREAD', `effective=${effectiveSpread} < minSpread=${this.config.minSpread}`, t);
        return this.pauseResult(
          `spread too tight: ${effectiveSpread} < ${this.config.minSpread}`,
          phases,
          excludedAggressive,
        );
      }
      trace(3, 'SPREAD', `effective=${effectiveSpread}${inverted ? ' (inverted — favorable)' : ''}`, t);
    }

    // ── Phase 4: VOLUME ─────────────────────────────────────────────────────
    {
      const t = Date.now();
      const sellVol = assessVolume(this.filteredSell, 'sell');
      const buyVol = assessVolume(this.filteredBuy, 'buy');
      trace(
        4,
        'VOLUME',
        `sell.effectiveTop=${sellVol.effectiveTopPrice} skipped=${sellVol.skippedThinTop} | buy.effectiveTop=${buyVol.effectiveTopPrice} skipped=${buyVol.skippedThinTop}`,
        t,
      );
    }

    // ── Phase 5: AGGRESSION ─────────────────────────────────────────────────
    let aggrSell = this.filteredSell;
    let aggrBuy = this.filteredBuy;
    {
      const t = Date.now();
      const sellResult = detectAggressive(this.filteredSell, 'sell');
      const buyResult = detectAggressive(this.filteredBuy, 'buy');

      if (sellResult.excluded) {
        const ex = sellResult.excluded;
        const nextPrice = sellResult.remaining[0]?.price ?? ex.price;
        const gap = Math.abs(nextPrice - ex.price);
        excludedAggressive.push({ side: 'sell', nickName: ex.nickName, price: ex.price, gap });
        aggrSell = sellResult.remaining;
      }
      if (buyResult.excluded) {
        const ex = buyResult.excluded;
        const nextPrice = buyResult.remaining[0]?.price ?? ex.price;
        const gap = Math.abs(nextPrice - ex.price);
        excludedAggressive.push({ side: 'buy', nickName: ex.nickName, price: ex.price, gap });
        aggrBuy = buyResult.remaining;
      }

      trace(5, 'AGGRESSION', `excluded=${excludedAggressive.length}`, t);
    }

    // ── Phase 6: OPTIMAL PRICE ──────────────────────────────────────────────
    let optSellPrice: number;
    let optBuyPrice: number;
    {
      const t = Date.now();
      optSellPrice = calculateOptimalPrice(aggrSell, 'sell', this.config.targetPosition);
      optBuyPrice = calculateOptimalPrice(aggrBuy, 'buy', this.config.targetPosition);
      trace(6, 'OPTIMAL PRICE', `sell=${optSellPrice} buy=${optBuyPrice}`, t);
    }

    // ── Phase 7: SAFETY BOUNDS ──────────────────────────────────────────────
    let boundedBuy: number;
    let boundedSell: number;
    {
      const t = Date.now();
      const bounded = applySafetyBounds(optBuyPrice, optSellPrice, this.config.minSpread, this.config.maxSpread);
      boundedBuy = bounded.buyPrice;
      boundedSell = bounded.sellPrice;
      trace(7, 'SAFETY BOUNDS', `sell=${boundedSell} buy=${boundedBuy}`, t);
    }

    // ── Phase 8: PROFITABILITY ──────────────────────────────────────────────
    {
      const t = Date.now();
      if (boundedBuy >= boundedSell) {
        trace(8, 'PROFITABILITY', `inverted: buy=${boundedBuy} >= sell=${boundedSell}`, t);
        return this.pauseResult(
          `spread inversion: buy ${boundedBuy} >= sell ${boundedSell}`,
          phases,
          excludedAggressive,
        );
      }
      trace(8, 'PROFITABILITY', `ok: spread=${boundedSell - boundedBuy}`, t);
    }

    // ── Phase 9: ANTI-OSCILLATION ───────────────────────────────────────────
    {
      const t = Date.now();
      const shouldHold = checkAntiOscillation(
        boundedBuy,
        boundedSell,
        currentPrices.buy,
        currentPrices.sell,
        this.config.antiOscillationThreshold,
      );
      trace(9, 'ANTI-OSCILLATION', shouldHold ? 'hold' : 'reprice', t);

      if (shouldHold) {
        return this.holdResult('anti-oscillation: change below threshold', phases, excludedAggressive);
      }
    }

    // ── Phase 10: POSITION ──────────────────────────────────────────────────
    let positionSell: number;
    let positionBuy: number;
    {
      const t = Date.now();
      positionSell = calculatePosition(this.filteredSell, boundedSell, 'sell');
      positionBuy = calculatePosition(this.filteredBuy, boundedBuy, 'buy');
      trace(10, 'POSITION', `sell=#${positionSell} buy=#${positionBuy}`, t);
    }

    // ── Phase 11: RESULT ────────────────────────────────────────────────────
    const finalSpread = Math.round((boundedSell - boundedBuy) * 1000) / 1000;

    const result: RepricingResult = {
      buyPrice: boundedBuy,
      sellPrice: boundedSell,
      spread: finalSpread,
      position: { buy: positionBuy, sell: positionSell },
      filteredCompetitors: { buy: this.filteredBuy.length, sell: this.filteredSell.length },
      action: 'reprice',
      mode: this.config.mode,
      reason: 'repriced successfully',
      phases,
      excludedAggressive,
    };

    this.lastResult = result;
    log.debug({ result }, 'reprice done');

    return result;
  }

  getLastResult(): RepricingResult | null {
    return this.lastResult;
  }

  getFilteredOrderBook(): { sell: OrderBookAd[]; buy: OrderBookAd[] } {
    return { sell: this.filteredSell, buy: this.filteredBuy };
  }

  updateConfig(partial: Partial<RepricingConfig>): void {
    this.config = { ...this.config, ...partial };

    // Apply mode presets if mode changed
    if (partial.mode) {
      const preset = MODE_PRESETS[partial.mode];
      this.config = { ...this.config, ...preset };

      // Allow explicit overrides to take precedence over presets
      if (partial.targetPosition !== undefined) {
        this.config.targetPosition = partial.targetPosition;
      }
      if (partial.antiOscillationThreshold !== undefined) {
        this.config.antiOscillationThreshold = partial.antiOscillationThreshold;
      }
    }
  }

  getConfig(): RepricingConfig {
    return { ...this.config };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private holdResult(
    reason: string,
    phases: PhaseTrace[],
    excludedAggressive: Array<{ side: Side; nickName: string; price: number; gap: number }>,
  ): RepricingResult {
    const result: RepricingResult = {
      buyPrice: 0,
      sellPrice: 0,
      spread: 0,
      position: { buy: 0, sell: 0 },
      filteredCompetitors: { buy: 0, sell: 0 },
      action: 'hold',
      mode: this.config.mode,
      reason,
      phases,
      excludedAggressive,
    };
    this.lastResult = result;
    return result;
  }

  private pauseResult(
    reason: string,
    phases: PhaseTrace[],
    excludedAggressive: Array<{ side: Side; nickName: string; price: number; gap: number }>,
  ): RepricingResult {
    const result: RepricingResult = {
      buyPrice: 0,
      sellPrice: 0,
      spread: 0,
      position: { buy: 0, sell: 0 },
      filteredCompetitors: { buy: 0, sell: 0 },
      action: 'pause',
      mode: this.config.mode,
      reason,
      phases,
      excludedAggressive,
    };
    this.lastResult = result;
    return result;
  }
}
