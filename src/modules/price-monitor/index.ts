import { createModuleLogger } from '../../utils/logger.js';
import type { EventBus, PlatformPrices } from '../../event-bus.js';
import type { DB } from '../../db/index.js';
import type { CriptoYaClient } from './criptoya.js';
import type { BybitClient } from '../../bybit/client.js';
import type { PriceSnapshot } from './types.js';

const log = createModuleLogger('price-monitor');

const MODULE = 'PriceMonitor';
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export interface PriceMonitorConfig {
  volatilityThresholdPercent: number;
  volatilityWindowMinutes: number;
}

const DEFAULT_CONFIG: PriceMonitorConfig = {
  volatilityThresholdPercent: 2,
  volatilityWindowMinutes: 5,
};

export class PriceMonitor {
  private readonly bus: EventBus;
  private readonly db: DB;
  private readonly client: CriptoYaClient;
  private readonly bybit: BybitClient | null;
  private config: PriceMonitorConfig;

  private latestPrices: PlatformPrices[] = [];
  private bybitDirect: PlatformPrices | null = null;
  private priceWindow: PriceSnapshot[] = [];
  private lastUpdateTime = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    bus: EventBus,
    db: DB,
    client: CriptoYaClient,
    config?: Partial<PriceMonitorConfig>,
    bybit?: BybitClient,
  ) {
    this.bus = bus;
    this.db = db;
    this.client = client;
    this.bybit = bybit ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fetch best ask (lowest sell ad) and best bid (highest buy ad) directly from Bybit P2P API.
   * Returns full decimal precision from the orderbook.
   */
  private async fetchBybitDirect(): Promise<PlatformPrices | null> {
    if (!this.bybit) return null;
    try {
      const [sellAds, buyAds] = await Promise.all([
        this.bybit.getOnlineAds('sell', 'USDT', 'BOB'),
        this.bybit.getOnlineAds('buy', 'USDT', 'BOB'),
      ]);

      // Best ask = lowest price among sell ads (what buyers see)
      const bestAsk = sellAds.length > 0
        ? Math.min(...sellAds.map((a) => a.price))
        : 0;
      // Best bid = highest price among buy ads (what sellers see)
      const bestBid = buyAds.length > 0
        ? Math.max(...buyAds.map((a) => a.price))
        : 0;

      const now = Math.floor(Date.now() / 1000);
      const entry: PlatformPrices = {
        platform: 'bybit',
        ask: bestAsk,
        totalAsk: sellAds.reduce((sum, a) => sum + a.amount, 0),
        bid: bestBid,
        totalBid: buyAds.reduce((sum, a) => sum + a.amount, 0),
        time: now,
      };

      log.info({ ask: bestAsk, bid: bestBid, sellAds: sellAds.length, buyAds: buyAds.length }, 'Bybit direct prices fetched');
      return entry;
    } catch (err) {
      log.error({ err }, 'Failed to fetch Bybit direct prices');
      return null;
    }
  }

  async fetchOnce(): Promise<void> {
    try {
      const prices = await this.client.getUsdtBobPrices();

      // Fetch direct Bybit prices with full precision
      const directBybit = await this.fetchBybitDirect();
      if (directBybit) {
        this.bybitDirect = directBybit;
        // Replace the CriptoYa bybit entry with our direct one
        const filtered = prices.filter((p) => !p.platform.startsWith('bybit'));
        filtered.unshift(directBybit);
        this.latestPrices = filtered;
      } else {
        this.latestPrices = prices;
      }

      const now = Date.now();
      this.lastUpdateTime = now;

      await this.bus.emit('price:updated', { prices: this.latestPrices, timestamp: now }, MODULE);
      log.info({ count: this.latestPrices.length }, 'Prices updated');

      // Compute reference price: use direct Bybit if available
      const bybitEntry = this.bybitDirect ?? this.latestPrices.find((p) => p.platform.startsWith('bybit'));
      const refPrice = bybitEntry ? bybitEntry.bid : this.latestPrices[0]?.bid;

      if (refPrice !== undefined) {
        await this.checkVolatility(refPrice, now);
      }
    } catch (err) {
      log.error({ err }, 'Failed to fetch prices');

      if (this.lastUpdateTime > 0) {
        const staleDurationMs = Date.now() - this.lastUpdateTime;
        if (staleDurationMs > STALE_THRESHOLD_MS) {
          const staleDurationSeconds = Math.floor(staleDurationMs / 1000);
          await this.bus.emit(
            'price:stale',
            { lastUpdate: this.lastUpdateTime, staleDurationSeconds },
            MODULE,
          );
          log.warn({ staleDurationSeconds }, 'Stale price data detected');
        }
      }
    }
  }

  private async checkVolatility(currentPrice: number, now: number): Promise<void> {
    const windowMs = this.config.volatilityWindowMinutes * 60 * 1000;

    // Trim old snapshots outside the window
    this.priceWindow = this.priceWindow.filter((s) => now - s.timestamp <= windowMs);

    if (this.priceWindow.length > 0) {
      const oldestSnapshot = this.priceWindow[0];
      const previousPrice = oldestSnapshot.price;
      const changePercent = Math.abs((currentPrice - previousPrice) / previousPrice) * 100;

      if (changePercent > this.config.volatilityThresholdPercent) {
        await this.bus.emit(
          'price:volatility-alert',
          {
            currentPrice,
            previousPrice,
            changePercent,
            windowMinutes: this.config.volatilityWindowMinutes,
          },
          MODULE,
        );
        log.warn({ currentPrice, previousPrice, changePercent }, 'Volatility alert');
      }
    }

    // Always push the current snapshot
    this.priceWindow.push({ price: currentPrice, timestamp: now });
  }

  start(intervalMs: number): void {
    if (this.intervalHandle !== null) {
      log.warn('PriceMonitor already running');
      return;
    }
    log.info({ intervalMs }, 'Starting PriceMonitor');
    void this.fetchOnce();
    this.intervalHandle = setInterval(() => void this.fetchOnce(), intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      log.info('PriceMonitor stopped');
    }
  }

  getLatestPrices(): PlatformPrices[] {
    return this.latestPrices;
  }

  getBybitPrices(): PlatformPrices | undefined {
    return this.bybitDirect ?? this.latestPrices.find((p) => p.platform.startsWith('bybit'));
  }

  setVolatilityThreshold(percent: number): void {
    this.config = { ...this.config, volatilityThresholdPercent: percent };
    log.info({ percent }, 'Volatility threshold updated');
  }

  setVolatilityWindow(minutes: number): void {
    this.config = { ...this.config, volatilityWindowMinutes: minutes };
    log.info({ minutes }, 'Volatility window updated');
  }
}
