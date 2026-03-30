// src/simulator/engine.ts

import { calculatePricing } from '../modules/ad-manager/pricing.js';
import type { PricingConfig } from '../modules/ad-manager/types.js';
import { EventBus } from '../event-bus.js';
import type { EventMap } from '../event-bus.js';
import { createTestDB } from '../db/index.js';
import { bankAccounts } from '../db/schema.js';
import { PriceMonitor } from '../modules/price-monitor/index.js';
import { AdManager } from '../modules/ad-manager/index.js';
import { EmergencyStop } from '../modules/emergency-stop/index.js';
import { ReplayPriceSource } from './mocks/replay-price-source.js';
import { MockBybitClient } from './mocks/mock-bybit-client.js';
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
  let inEmergency = false;

  for (const tick of scenario.ticks) {
    const events: string[] = [];

    // If in emergency, all ticks are paused (simulates EmergencyStop behavior)
    if (inEmergency) {
      timeline.push({
        tick: clock.tickCount + 1,
        elapsed: clock.elapsed(),
        ask: tick.ask,
        bid: tick.bid,
        marketSpread: tick.ask > 0 && tick.bid > 0 ? tick.ask - tick.bid : 0,
        buyPrice: null,
        sellPrice: null,
        botSpread: null,
        events: ['emergency:active'],
        paused: true,
        pauseReason: 'emergency',
      });
      clock.advance(scenario.tickIntervalMs);
      continue;
    }

    // Detect market spread inversion (bid > ask) — mirrors EmergencyStop behavior
    const spreadInverted = tick.ask > 0 && tick.bid > 0 && tick.bid > tick.ask;
    if (spreadInverted) {
      events.push(`paused(spread-inversion)`);
      events.push(`emergency:triggered(spread_inversion)`);
      inEmergency = true;
      timeline.push({
        tick: clock.tickCount + 1,
        elapsed: clock.elapsed(),
        ask: tick.ask,
        bid: tick.bid,
        marketSpread: tick.ask - tick.bid,
        buyPrice: null,
        sellPrice: null,
        botSpread: null,
        events,
        paused: true,
        pauseReason: 'spread-inversion',
      });
      clock.advance(scenario.tickIntervalMs);
      continue;
    }

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
        events.push(`emergency:triggered(volatility)`);
        inEmergency = true;
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
    summary: buildSummary(timeline),
  };
}

// ---------------------------------------------------------------------------
// Integration mode — wires real modules with mock dependencies
// ---------------------------------------------------------------------------

export async function runIntegration(
  scenario: Scenario,
  pricingConfig: PricingConfig,
  volatilityConfig: VolatilityConfig,
): Promise<SimulationResult> {
  const { db, close } = createTestDB();

  try {
    // Seed a mock bank account so ad inserts satisfy the FK constraint
    await db.insert(bankAccounts).values({
      id: 1,
      name: 'MockBank',
      bank: 'MockBank',
      accountHint: '***000',
    });

    const bus = new EventBus(db);
    const clock = new SimulatedClock(0);

    // Mock dependencies
    const replaySource = new ReplayPriceSource(scenario.ticks);
    const mockBybit = new MockBybitClient();

    // Wire real modules with mock deps (cast mocks to satisfy module type constraints).
    // We intentionally omit the bybit client from PriceMonitor so it uses only
    // the ReplayPriceSource (CriptoYa mock) — the MockBybitClient returns empty
    // online ads which would zero-out prices and break volatility detection.
    const priceMonitor = new PriceMonitor(
      bus,
      db,
      replaySource as any,
      volatilityConfig,
    );

    const adManager = new AdManager(
      bus,
      db,
      mockBybit as any,
      pricingConfig,
      () => ({ id: 1, name: 'MockBank' }),
    );

    // Initialise AdManager payment methods from mock
    await adManager.syncExistingAds();

    let emergencyActive = false;

    const emergencyStop = new EmergencyStop(bus, db, {
      removeAllAds: () => adManager.removeAllAds(),
      getExposure: async () => ({ usdt: 0, bob: 0 }),
      getMarketState: () => {
        const prices = priceMonitor.getLatestPrices();
        const bybit = prices.find((p) => p.platform.startsWith('bybit'));
        return { ask: bybit?.ask ?? 0, bid: bybit?.bid ?? 0 };
      },
      getPendingOrderCount: () => 0,
      stopPolling: () => {
        emergencyActive = true;
      },
      startPolling: () => {
        emergencyActive = false;
      },
    });

    // Collect events per tick
    let pendingEvents: string[] = [];

    const trackedEvents: (keyof EventMap)[] = [
      'price:updated',
      'price:volatility-alert',
      'price:stale',
      'ad:created',
      'ad:repriced',
      'ad:paused',
      'ad:resumed',
      'ad:spread-inversion',
      'emergency:triggered',
      'emergency:resolved',
    ];

    for (const event of trackedEvents) {
      bus.on(event, (payload: any) => {
        if (event === 'emergency:triggered') {
          pendingEvents.push(`emergency:triggered(${payload.reason})`);
        } else if (event === 'ad:created') {
          pendingEvents.push(`ad:created(${payload.side},${payload.price})`);
        } else if (event === 'ad:repriced') {
          pendingEvents.push(`repriced(${payload.side}:${payload.oldPrice}->${payload.newPrice})`);
        } else if (event === 'ad:paused') {
          pendingEvents.push(`ad:paused(${payload.side},${payload.reason})`);
        } else if (event === 'price:volatility-alert') {
          pendingEvents.push(`volatility-alert(${payload.changePercent.toFixed(1)}%)`);
        } else {
          pendingEvents.push(event);
        }
      });
    }

    // Process each tick
    const timeline: TimelineEntry[] = [];

    for (const tick of scenario.ticks) {
      pendingEvents = [];

      // Advance clock and set mock times
      replaySource.setTime(clock.now());
      mockBybit.setTime(clock.now());

      // 1. PriceMonitor fetches prices -> emits price:updated -> may emit volatility-alert
      await priceMonitor.fetchOnce();

      // 2. AdManager tick (if not in emergency)
      if (!emergencyActive) {
        try {
          await adManager.tick();
        } catch {
          // AdManager errors are logged but don't crash the simulation
        }
      }

      // Determine pricing state for timeline
      const prices = priceMonitor.getLatestPrices();
      const bybitEntry = prices.find((p) => p.platform.startsWith('bybit'));
      const currentAsk = bybitEntry?.ask ?? tick.ask;
      const currentBid = bybitEntry?.bid ?? tick.bid;

      // Check what AdManager computed
      const currentPricing = adManager.getCurrentPrices();
      let buyPrice: number | null = null;
      let sellPrice: number | null = null;
      let botSpread: number | null = null;
      let paused = false;

      if (emergencyActive) {
        paused = true;
      } else if (currentPricing) {
        buyPrice = currentPricing.buyPrice;
        sellPrice = currentPricing.sellPrice;
        botSpread = currentPricing.spread;
      } else {
        // Fallback — use calculatePricing on the current prices
        const result = calculatePricing(prices, pricingConfig);
        paused = result.paused.buy && result.paused.sell;
        if (!paused) {
          buyPrice = result.buyPrice;
          sellPrice = result.sellPrice;
          botSpread = result.spread;
        }
      }

      timeline.push({
        tick: clock.tickCount + 1,
        elapsed: clock.elapsed(),
        ask: currentAsk,
        bid: currentBid,
        marketSpread: currentAsk > 0 && currentBid > 0 ? currentAsk - currentBid : 0,
        buyPrice,
        sellPrice,
        botSpread,
        events: [...pendingEvents],
        paused,
        pauseReason: emergencyActive ? 'emergency' : undefined,
      });

      clock.advance(scenario.tickIntervalMs);
    }

    // Clean up listeners
    bus.removeAllListeners();

    return {
      scenario: scenario.name,
      mode: 'integration',
      timeline,
      summary: buildSummary(timeline),
    };
  } finally {
    close();
  }
}
