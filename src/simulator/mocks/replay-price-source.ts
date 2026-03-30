// src/simulator/mocks/replay-price-source.ts

import type { PlatformPrices } from '../../event-bus.js';
import type { ScenarioTick } from '../types.js';

/**
 * CriptoYaClient-compatible mock that returns scenario ticks in sequence.
 * PriceMonitor calls client.getUsdtBobPrices() — this returns the next tick.
 */
export class ReplayPriceSource {
  private readonly ticks: ScenarioTick[];
  private cursor = 0;
  private timeMs = 0;

  constructor(ticks: ScenarioTick[]) {
    this.ticks = ticks;
  }

  setTime(ms: number): void {
    this.timeMs = ms;
  }

  async getUsdtBobPrices(): Promise<PlatformPrices[]> {
    if (this.cursor >= this.ticks.length) {
      return [{
        platform: 'bybitp2p',
        ask: 0,
        bid: 0,
        totalAsk: 0,
        totalBid: 0,
        time: Math.floor(this.timeMs / 1000),
      }];
    }

    const tick = this.ticks[this.cursor++];
    return [{
      platform: 'bybitp2p',
      ask: tick.ask,
      bid: tick.bid,
      totalAsk: tick.totalAsk,
      totalBid: tick.totalBid,
      time: Math.floor(this.timeMs / 1000),
    }];
  }

  async getFees(): Promise<unknown> {
    return {};
  }
}
