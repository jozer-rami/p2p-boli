// src/simulator/engine.ts

import { calculatePricing } from '../modules/ad-manager/pricing.js';
import type { PricingConfig } from '../modules/ad-manager/types.js';
import { SimulatedClock } from './clock.js';
import { tickToPlatformPrices } from './types.js';
import type {
  Scenario,
  SimulationResult,
  SimulationSummary,
  TimelineEntry,
} from './types.js';

export interface VolatilityConfig {
  volatilityThresholdPercent: number;
  volatilityWindowMinutes: number;
}

export interface PriceSnapshot {
  price: number;
  timestamp: number;
}

export function checkVolatility(
  currentPrice: number,
  now: number,
  window: PriceSnapshot[],
  config: VolatilityConfig,
): { alert: boolean; changePercent: number } {
  const windowMs = config.volatilityWindowMinutes * 60 * 1000;

  // Trim old entries
  while (window.length > 0 && now - window[0].timestamp > windowMs) {
    window.shift();
  }

  let alert = false;
  let changePercent = 0;

  if (window.length > 0) {
    const oldest = window[0];
    changePercent = Math.abs((currentPrice - oldest.price) / oldest.price) * 100;
    alert = changePercent > config.volatilityThresholdPercent;
  }

  window.push({ price: currentPrice, timestamp: now });
  return { alert, changePercent };
}

export function buildSummary(
  timeline: TimelineEntry[],
  _clock: SimulatedClock,
  _scenario: Scenario,
): SimulationSummary {
  const spreads = timeline
    .filter((t) => t.botSpread !== null)
    .map((t) => t.botSpread as number);

  const emergencyEntry = timeline.find((t) =>
    t.events.some((e) => e.includes('emergency')),
  );

  // Duration is the elapsed time of the last timeline entry (last tick processed)
  const simulatedDuration =
    timeline.length > 0 ? timeline[timeline.length - 1].elapsed : '00:00:00';

  return {
    totalTicks: timeline.length,
    simulatedDuration,
    repriceCount: timeline.filter((t) =>
      t.events.some((e) => e.includes('repriced')),
    ).length,
    pauseCount: timeline.filter((t) => t.paused).length,
    emergencyTriggered: !!emergencyEntry,
    emergencyAtTick: emergencyEntry?.tick ?? null,
    emergencyReason: emergencyEntry
      ? emergencyEntry.events.find((e) => e.includes('emergency')) ?? null
      : null,
    maxSpread: spreads.length > 0 ? Math.max(...spreads) : 0,
    minSpread: spreads.length > 0 ? Math.min(...spreads) : 0,
  };
}

export function runUnit(
  scenario: Scenario,
  pricingConfig: PricingConfig,
  volatilityConfig: VolatilityConfig,
): SimulationResult {
  const clock = new SimulatedClock(0);
  const priceWindow: PriceSnapshot[] = [];
  const timeline: TimelineEntry[] = [];
  let prevBuyPrice: number | null = null;
  let prevSellPrice: number | null = null;

  for (const tick of scenario.ticks) {
    const events: string[] = [];
    const prices = [tickToPlatformPrices(tick, clock.now())];
    const result = calculatePricing(prices, pricingConfig);

    const paused = result.paused.buy || result.paused.sell;
    let buyPrice: number | null = null;
    let sellPrice: number | null = null;
    let botSpread: number | null = null;

    if (!paused) {
      buyPrice = result.buyPrice;
      sellPrice = result.sellPrice;
      botSpread = result.spread;

      // Detect reprices
      if (prevBuyPrice !== null && prevSellPrice !== null) {
        if (
          Math.abs(buyPrice - prevBuyPrice) > 0.0001 ||
          Math.abs(sellPrice - prevSellPrice) > 0.0001
        ) {
          events.push(`repriced(buy:${buyPrice.toFixed(3)},sell:${sellPrice.toFixed(3)})`);
        }
      } else {
        events.push(`priced(buy:${buyPrice.toFixed(3)},sell:${sellPrice.toFixed(3)})`);
      }
      prevBuyPrice = buyPrice;
      prevSellPrice = sellPrice;
    } else {
      events.push(`paused(${result.paused.reason ?? 'unknown'})`);
      prevBuyPrice = null;
      prevSellPrice = null;
    }

    // Volatility check (use bid as reference price, matching PriceMonitor)
    if (tick.bid > 0) {
      const vol = checkVolatility(tick.bid, clock.now(), priceWindow, volatilityConfig);
      if (vol.alert) {
        events.push(`volatility-alert(${vol.changePercent.toFixed(1)}%)`);
      }
    }

    timeline.push({
      tick: clock.tickCount + 1,
      elapsed: clock.elapsed(),
      ask: tick.ask,
      bid: tick.bid,
      marketSpread: tick.ask > 0 && tick.bid > 0 ? tick.ask - tick.bid : 0,
      buyPrice,
      sellPrice,
      botSpread,
      events,
      paused,
      pauseReason: paused ? result.paused.reason : undefined,
    });

    clock.advance(scenario.tickIntervalMs);
  }

  return {
    scenario: scenario.name,
    mode: 'unit',
    timeline,
    summary: buildSummary(timeline, clock, scenario),
  };
}
