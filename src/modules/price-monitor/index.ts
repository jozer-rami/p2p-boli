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
  gapGuardEnabled?: boolean;
  gapGuardThresholdPercent?: number;
  depthGuardEnabled?: boolean;
  depthGuardMinUsdt?: number;
  sessionDriftGuardEnabled?: boolean;
  sessionDriftThresholdPercent?: number;
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
  private lastKnownPrice: number | null = null;
  private lastSuccessfulFetch = 0;
  private sessionBasePrice: number | null = null;

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

    this.bus.on('emergency:resolved', () => {
      this.sessionBasePrice = null;
      log.info('Session base price reset (emergency resolved)');
    });
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

      // Guards
      if (refPrice !== undefined) {
        await this.checkGapGuard(refPrice, now);
        await this.checkSessionDrift(refPrice);
      }
      await this.checkDepthGuard(this.latestPrices);
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

  private async checkGapGuard(currentBid: number, now: number): Promise<void> {
    if (!this.config.gapGuardEnabled) return;

    const threshold = this.config.gapGuardThresholdPercent ?? 2;
    const windowMs = this.config.volatilityWindowMinutes * 60 * 1000;

    if (this.lastKnownPrice !== null && this.lastSuccessfulFetch > 0) {
      const gapMs = now - this.lastSuccessfulFetch;
      if (gapMs > windowMs) {
        const changePercent = Math.abs((currentBid - this.lastKnownPrice) / this.lastKnownPrice) * 100;
        if (changePercent > threshold) {
          await this.bus.emit('price:gap-alert', {
            lastKnownPrice: this.lastKnownPrice,
            resumePrice: currentBid,
            changePercent,
            gapDurationSeconds: Math.floor(gapMs / 1000),
          }, MODULE);
          log.warn({ lastKnownPrice: this.lastKnownPrice, resumePrice: currentBid, changePercent }, 'Gap guard alert');
        }
      }
    }

    this.lastKnownPrice = currentBid;
    this.lastSuccessfulFetch = now;
  }

  private async checkDepthGuard(prices: PlatformPrices[]): Promise<void> {
    if (!this.config.depthGuardEnabled) return;

    const minUsdt = this.config.depthGuardMinUsdt ?? 100;
    const bybit = prices.find((p) => p.platform.startsWith('bybit'));
    if (!bybit) return;

    if (bybit.totalAsk < minUsdt || bybit.totalBid < minUsdt) {
      await this.bus.emit('price:low-depth', {
        totalAsk: bybit.totalAsk,
        totalBid: bybit.totalBid,
        minRequired: minUsdt,
      }, MODULE);
      log.warn({ totalAsk: bybit.totalAsk, totalBid: bybit.totalBid, minUsdt }, 'Low depth alert');
    }
  }

  private async checkSessionDrift(currentBid: number): Promise<void> {
    if (!this.config.sessionDriftGuardEnabled) return;

    const threshold = this.config.sessionDriftThresholdPercent ?? 3;

    if (this.sessionBasePrice === null) {
      this.sessionBasePrice = currentBid;
      log.info({ sessionBasePrice: currentBid }, 'Session base price set');
      return;
    }

    const driftPercent = Math.abs((currentBid - this.sessionBasePrice) / this.sessionBasePrice) * 100;
    if (driftPercent > threshold) {
      await this.bus.emit('price:session-drift', {
        sessionBasePrice: this.sessionBasePrice,
        currentPrice: currentBid,
        driftPercent,
      }, MODULE);
      log.warn({ sessionBasePrice: this.sessionBasePrice, currentPrice: currentBid, driftPercent }, 'Session drift alert');
    }
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

  setVolatilityConfig(updates: { thresholdPercent?: number; windowMinutes?: number }): void {
    if (updates.thresholdPercent !== undefined) this.config.volatilityThresholdPercent = updates.thresholdPercent;
    if (updates.windowMinutes !== undefined) this.config.volatilityWindowMinutes = updates.windowMinutes;
    log.info({ volatilityConfig: this.config }, 'Volatility config updated');
  }

  restart(intervalMs: number): void {
    this.stop();
    this.start(intervalMs);
    log.info({ intervalMs }, 'PriceMonitor restarted with new interval');
  }

  updateGuardConfig(updates: Partial<PriceMonitorConfig>): void {
    this.config = { ...this.config, ...updates };
    log.info({ updates }, 'Guard config updated');
  }

  getGuardConfig(): {
    gapGuardEnabled: boolean;
    gapGuardThresholdPercent: number;
    depthGuardEnabled: boolean;
    depthGuardMinUsdt: number;
    sessionDriftGuardEnabled: boolean;
    sessionDriftThresholdPercent: number;
  } {
    return {
      gapGuardEnabled: this.config.gapGuardEnabled ?? false,
      gapGuardThresholdPercent: this.config.gapGuardThresholdPercent ?? 2,
      depthGuardEnabled: this.config.depthGuardEnabled ?? false,
      depthGuardMinUsdt: this.config.depthGuardMinUsdt ?? 100,
      sessionDriftGuardEnabled: this.config.sessionDriftGuardEnabled ?? false,
      sessionDriftThresholdPercent: this.config.sessionDriftThresholdPercent ?? 3,
    };
  }
}
