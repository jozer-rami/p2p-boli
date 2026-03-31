import { eq } from 'drizzle-orm';
import { ads } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import type { EventBus, PlatformPrices, Side } from '../../event-bus.js';
import type { BybitClient } from '../../bybit/client.js';
import { calculatePricing } from './pricing.js';
import type { PricingConfig } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';
import type { RepricingEngine } from '../repricing-engine/index.js';

const log = createModuleLogger('ad-manager');

const MODULE = 'AdManager';

export interface ActiveAd {
  bybitAdId: string;
  side: Side;
  price: number;
  amountUsdt: number;
  bankAccountId: number | null;
}

export interface BankAccountRef {
  id: number;
  name: string;
}

export type GetBankAccount = (
  side: Side,
  amount: number,
) => BankAccountRef | null;

/** Bybit P2P token/fiat constants for BOB/USDT market */
const CURRENCY_ID = 'USDT';
const FIAT_ID = 'BOB';
/** Payment method IDs loaded from Bybit at startup */
let PAYMENT_METHOD_IDS: string[] = [];

export class AdManager {
  private readonly bus: EventBus;
  private readonly db: DB;
  private readonly bybit: BybitClient;
  private config: PricingConfig;
  private readonly getBankAccount: GetBankAccount;

  private latestPrices: PlatformPrices[] = [];
  private activeAds: Map<Side, ActiveAd> = new Map();
  private pausedSides: Map<Side, boolean> = new Map([
    ['buy', false],
    ['sell', false],
  ]);

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private repriceEnabled = true;
  private waitingForSpread = false;
  private lastBybitAsk = 0;
  private lastBybitBid = 0;
  private engine: RepricingEngine | null = null;
  private tickCount = 0;
  /** How often (in ticks) to fully sync ad amounts from Bybit */
  private readonly syncEveryNTicks = 5;
  /** Tracks whether a refill is allowed per side (only after a confirmed release) */
  private refillAllowed: Map<Side, boolean> = new Map([
    ['buy', false],
    ['sell', false],
  ]);
  /** Cumulative released volume per side (USDT) — for imbalance tracking */
  private releasedVolume: Map<Side, number> = new Map([
    ['buy', 0],
    ['sell', 0],
  ]);
  /** Sides paused by the imbalance limiter (separate from manual pause) */
  private imbalancePaused: Map<Side, boolean> = new Map([
    ['buy', false],
    ['sell', false],
  ]);

  constructor(
    bus: EventBus,
    db: DB,
    bybit: BybitClient,
    config: PricingConfig,
    getBankAccount: GetBankAccount,
  ) {
    this.bus = bus;
    this.db = db;
    this.bybit = bybit;
    this.config = config;
    this.getBankAccount = getBankAccount;

    // Subscribe to live price updates
    this.bus.on('price:updated', ({ prices }) => {
      this.latestPrices = prices;
    });

    // Track ad liquidity: subtract filled amount on new orders
    this.bus.on('order:new', ({ side, amount }) => {
      const ad = this.activeAds.get(side);
      if (ad) {
        const prev = ad.amountUsdt;
        ad.amountUsdt = Math.max(0, ad.amountUsdt - amount);
        log.info({ side, orderId: 'n/a', orderAmount: amount, prev, remaining: ad.amountUsdt }, 'Ad liquidity reduced by new order');
      }
    });

    // Allow refill only after a confirmed release (you got paid)
    // Also track released volume for imbalance detection
    this.bus.on('order:released', ({ side, amount }) => {
      this.refillAllowed.set(side, true);

      // Accumulate released volume
      const prev = this.releasedVolume.get(side) ?? 0;
      this.releasedVolume.set(side, prev + amount);

      // Check if the opposite side can be unpaused
      this.checkImbalance();

      log.info({ side, amount, totalReleased: prev + amount }, 'Order released — ad refill allowed');
    });

    // Restore ad liquidity on cancelled orders
    this.bus.on('order:cancelled', ({ orderId }) => {
      // We don't know the side/amount from the event — schedule a full sync next tick
      this.tickCount = this.syncEveryNTicks;
      log.debug({ orderId }, 'Order cancelled — will sync ad amounts next tick');
    });
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  /**
   * Reads personal ads from Bybit and reconstructs in-memory state.
   * Call once during startup before starting the tick loop.
   */
  async syncExistingAds(): Promise<void> {
    try {
      // Load payment methods from Bybit
      const payments = await this.bybit.getPaymentMethods();
      PAYMENT_METHOD_IDS = payments.map((p) => p.id);
      log.info({ count: payments.length, ids: PAYMENT_METHOD_IDS }, 'Payment methods loaded');

      const bybitAds = await this.bybit.getPersonalAds();

      for (const ad of bybitAds) {
        // Only track active ads (status can be '1', 'active', '10', or 10)
        const s = String(ad.status);
        if (s !== '1' && s !== 'active' && s !== '10') continue;

        // Look up matching DB record for bank account association
        const dbRow = await this.db
          .select()
          .from(ads)
          .where(eq(ads.bybitAdId, ad.id))
          .get();

        this.activeAds.set(ad.side, {
          bybitAdId: ad.id,
          side: ad.side,
          price: ad.price,
          amountUsdt: ad.amount,
          bankAccountId: dbRow?.bankAccountId ?? null,
        });

        log.info({ adId: ad.id, side: ad.side, price: ad.price }, 'Synced existing ad');
      }
    } catch (err) {
      log.error({ err }, 'Failed to sync existing ads from Bybit');
    }
  }

  /**
   * Refreshes ad amounts from Bybit's lastQuantity to correct any drift
   * between local tracking and the actual remaining amount on the platform.
   */
  private async syncAdAmounts(): Promise<void> {
    try {
      const bybitAds = await this.bybit.getPersonalAds();

      for (const ad of bybitAds) {
        const s = String(ad.status);
        if (s !== '1' && s !== 'active' && s !== '10') continue;

        const existing = this.activeAds.get(ad.side);
        if (!existing || existing.bybitAdId !== ad.id) continue;

        if (Math.abs(existing.amountUsdt - ad.amount) > 0.01) {
          log.info(
            { side: ad.side, local: existing.amountUsdt, bybit: ad.amount },
            'Ad amount synced from Bybit',
          );
          existing.amountUsdt = ad.amount;
        }
      }
    } catch (err) {
      log.warn({ err }, 'Failed to sync ad amounts from Bybit — will retry next cycle');
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  async tick(): Promise<void> {
    // Periodic sync: refresh ad amounts from Bybit every N ticks
    this.tickCount++;
    if (this.tickCount >= this.syncEveryNTicks) {
      this.tickCount = 0;
      await this.syncAdAmounts();
    }

    // If engine is set, delegate to it
    if (this.engine) {
      try {
        const currentPrices = {
          buy: this.activeAds.get('buy')?.price ?? null,
          sell: this.activeAds.get('sell')?.price ?? null,
        };

        log.info({ currentPrices }, 'Running repricing engine cycle');
        const result = await this.engine.reprice(currentPrices);
        log.info({ action: result.action, buyPrice: result.buyPrice, sellPrice: result.sellPrice, spread: result.spread, position: result.position, reason: result.reason }, 'Repricing engine result');

        // Phase 12 — LOG: emit event
        await this.bus.emit('reprice:cycle', {
          action: result.action,
          buyPrice: result.buyPrice,
          sellPrice: result.sellPrice,
          spread: result.spread,
          position: result.position,
          filteredCompetitors: result.filteredCompetitors,
          mode: result.mode,
          reason: result.reason,
        }, MODULE);

        switch (result.action) {
          case 'reprice':
            for (const side of ['buy', 'sell'] as Side[]) {
              const price = side === 'buy' ? result.buyPrice : result.sellPrice;
              const manualPaused = this.pausedSides.get(side) ?? false;
              await this.manageSide(side, price, manualPaused);
            }
            break;
          case 'hold':
            log.debug({ reason: result.reason }, 'Repricing held');
            break;
          case 'pause':
            log.info({ reason: result.reason }, 'Repricing paused — removing ads');
            await this.removeAllAds();
            await this.bus.emit('ad:paused', { side: 'buy' as Side, reason: result.reason }, MODULE);
            await this.bus.emit('ad:paused', { side: 'sell' as Side, reason: result.reason }, MODULE);
            break;
        }
        return;
      } catch (err) {
        log.error({ err }, 'Repricing engine error — falling back to legacy pricing');
      }
    }

    // Legacy fallback (existing code below)
    if (this.latestPrices.length === 0) {
      log.debug('No prices yet — skipping tick');
      return;
    }

    // Check live Bybit order book spread before pricing
    try {
      const marketSpread = await this.checkBybitMarketSpread();
      if (marketSpread !== null && Math.abs(marketSpread) < this.config.minSpread) {
        if (!this.waitingForSpread) {
          this.waitingForSpread = true;
          const reason = `Market spread too thin (${marketSpread.toFixed(4)} BOB < min ${this.config.minSpread})`;
          log.info({ marketSpread, minSpread: this.config.minSpread }, reason);
          await this.bus.emit('ad:paused', { side: 'buy' as Side, reason }, MODULE);
          await this.bus.emit('ad:paused', { side: 'sell' as Side, reason }, MODULE);
          // Remove existing ads to avoid being at wrong price
          await this.removeAllAds();
        }
        return;
      }
      if (this.waitingForSpread && marketSpread !== null) {
        this.waitingForSpread = false;
        log.info({ marketSpread }, 'Market spread recovered — resuming');
        await this.bus.emit('ad:resumed', { side: 'buy' as Side }, MODULE);
        await this.bus.emit('ad:resumed', { side: 'sell' as Side }, MODULE);
      }
    } catch (err) {
      log.warn({ err }, 'Failed to check market spread — proceeding with CriptoYa data');
    }

    // Use Bybit order book for pricing (more accurate than CriptoYa)
    const bybitPrices = this.getCurrentPrices();
    let buyPrice: number;
    let sellPrice: number;

    if (bybitPrices) {
      buyPrice = bybitPrices.buyPrice;
      sellPrice = bybitPrices.sellPrice;
      log.debug({ buyPrice, sellPrice, spread: bybitPrices.spread, source: 'bybit-orderbook' }, 'Pricing calculated');
    } else {
      // Fallback to CriptoYa
      const pricing = calculatePricing(this.latestPrices, this.config);
      if (pricing.paused.buy && pricing.paused.sell) {
        log.warn({ reason: pricing.paused.reason }, 'CriptoYa fallback also paused');
        return;
      }
      buyPrice = pricing.buyPrice;
      sellPrice = pricing.sellPrice;
      log.debug({ buyPrice, sellPrice, source: 'criptoya-fallback' }, 'Pricing calculated');
    }

    const sides: Side[] = ['buy', 'sell'];
    for (const side of sides) {
      const price = side === 'buy' ? buyPrice : sellPrice;
      const manualPaused = this.pausedSides.get(side) ?? false;
      await this.manageSide(side, price, manualPaused);
    }
  }

  /**
   * Check the live Bybit P2P order book spread.
   * Returns the spread in BOB, or null if data unavailable.
   */
  private async checkBybitMarketSpread(): Promise<number | null> {
    const [sellAds, buyAds] = await Promise.all([
      this.bybit.getOnlineAds('sell', 'USDT', 'BOB'),
      this.bybit.getOnlineAds('buy', 'USDT', 'BOB'),
    ]);

    // Filter out outlier prices (e.g., the 6.850 ad)
    const validSellAds = sellAds.filter(a => a.price > 8 && a.price < 12);
    const validBuyAds = buyAds.filter(a => a.price > 8 && a.price < 12);

    if (validSellAds.length === 0 || validBuyAds.length === 0) return null;

    const bestAsk = Math.min(...validSellAds.map(a => a.price));  // cheapest seller
    const bestBid = Math.max(...validBuyAds.map(a => a.price));   // highest buyer

    this.lastBybitAsk = bestAsk;
    this.lastBybitBid = bestBid;

    const spread = bestAsk - bestBid;
    log.debug({ bestAsk, bestBid, spread: spread.toFixed(4) }, 'Bybit market spread');
    return spread;
  }

  /** Get the current buy/sell prices the bot is using */
  getCurrentPrices(): { buyPrice: number; sellPrice: number; spread: number } | null {
    if (this.lastBybitAsk === 0 || this.lastBybitBid === 0) return null;
    const mid = (this.lastBybitAsk + this.lastBybitBid) / 2;
    const spread = Math.abs(this.lastBybitAsk - this.lastBybitBid);
    const targetSpread = Math.max(this.config.minSpread, Math.min(this.config.maxSpread, spread));
    return {
      buyPrice: Math.round((mid - targetSpread / 2) * 1000) / 1000,
      sellPrice: Math.round((mid + targetSpread / 2) * 1000) / 1000,
      spread: targetSpread,
    };
  }

  // ---------------------------------------------------------------------------
  // Side management
  // ---------------------------------------------------------------------------

  async manageSide(side: Side, price: number, shouldPause: boolean): Promise<void> {
    const existing = this.activeAds.get(side);

    // Imbalance limiter overrides — treat as forced pause
    if (this.imbalancePaused.get(side)) {
      if (existing) {
        await this.removeAd(side);
      }
      return;
    }

    if (shouldPause) {
      if (existing) {
        await this.removeAd(side);
        await this.bus.emit('ad:paused', { side, reason: 'paused' }, MODULE);
      }
      return;
    }

    if (existing) {
      const priceChanged = this.repriceEnabled && Math.abs(existing.price - price) > 0.0001;
      const quantityLow = existing.amountUsdt < this.config.tradeAmountUsdt * 0.5;
      // Only refill after a confirmed release — prevents overexposure on pending orders
      const shouldRefill = quantityLow && this.refillAllowed.get(side);
      const needsUpdate = priceChanged || shouldRefill;

      if (needsUpdate) {
        try {
          const newAmount = shouldRefill ? this.config.tradeAmountUsdt : existing.amountUsdt;
          if (shouldRefill) {
            this.refillAllowed.set(side, false); // consume the refill allowance
          }
          await this.bybit.updateAd(existing.bybitAdId, price, newAmount, PAYMENT_METHOD_IDS);

          const oldPrice = existing.price;
          existing.price = price;
          existing.amountUsdt = newAmount;

          // Persist updated price/amount to DB
          await this.db
            .update(ads)
            .set({ price, amountUsdt: newAmount, updatedAt: new Date().toISOString() })
            .where(eq(ads.bybitAdId, existing.bybitAdId));

          if (priceChanged) {
            await this.bus.emit(
              'ad:repriced',
              { adId: existing.bybitAdId, side, oldPrice, newPrice: price },
              MODULE,
            );
          }

          if (shouldRefill) {
            log.info({ side, adId: existing.bybitAdId, oldAmount: existing.amountUsdt, newAmount }, 'Ad quantity refilled after confirmed release');
          }
          if (priceChanged) {
            log.info({ side, adId: existing.bybitAdId, oldPrice, newPrice: price }, 'Ad repriced');
          }
        } catch (err) {
          log.error({ err, side }, 'Failed to update ad');
        }
      }
      return;
    }

    // No existing ad — create a new one
    const bankAccount = this.getBankAccount(side, this.config.tradeAmountUsdt);
    if (!bankAccount) {
      log.warn({ side }, 'No bank account available — skipping ad creation');
      return;
    }

    try {
      const adId = await this.bybit.createAd({
        side,
        price,
        amount: this.config.tradeAmountUsdt,
        currencyId: CURRENCY_ID,
        fiatCurrencyId: FIAT_ID,
        paymentMethodIds: PAYMENT_METHOD_IDS,
        remark: 'Pago instantaneo por QR o transferencia bancaria. Liberacion rapida.',
      });

      const activeAd: ActiveAd = {
        bybitAdId: adId,
        side,
        price,
        amountUsdt: this.config.tradeAmountUsdt,
        bankAccountId: bankAccount.id,
      };

      this.activeAds.set(side, activeAd);
      this.refillAllowed.set(side, false); // new ad starts at full amount — no stale refill

      // Persist to DB
      await this.db.insert(ads).values({
        bybitAdId: adId,
        side,
        price,
        amountUsdt: this.config.tradeAmountUsdt,
        bankAccountId: bankAccount.id,
        status: 'active',
      });

      await this.bus.emit(
        'ad:created',
        { adId, side, price, bankAccount: bankAccount.name },
        MODULE,
      );

      log.info({ side, adId, price, bankAccount: bankAccount.name }, 'Ad created');
    } catch (err) {
      log.error({ err, side }, 'Failed to create ad');
    }
  }

  // ---------------------------------------------------------------------------
  // Ad removal
  // ---------------------------------------------------------------------------

  async removeAd(side: Side): Promise<void> {
    const existing = this.activeAds.get(side);
    if (!existing) return;

    try {
      await this.bybit.cancelAd(existing.bybitAdId);
    } catch (err) {
      log.error({ err, side, adId: existing.bybitAdId }, 'Failed to cancel ad on Bybit');
    }

    // Mark as cancelled in DB regardless of Bybit success
    try {
      await this.db
        .update(ads)
        .set({ status: 'cancelled', updatedAt: new Date().toISOString() })
        .where(eq(ads.bybitAdId, existing.bybitAdId));
    } catch (err) {
      log.error({ err, side }, 'Failed to update ad status in DB');
    }

    this.activeAds.delete(side);
    log.info({ side, adId: existing.bybitAdId }, 'Ad removed');
  }

  async removeAllAds(): Promise<void> {
    const sides: Side[] = ['buy', 'sell'];
    for (const side of sides) {
      await this.removeAd(side);
    }
  }

  // ---------------------------------------------------------------------------
  // Imbalance limiter
  // ---------------------------------------------------------------------------

  /**
   * Checks net exposure and pauses/unpauses sides accordingly.
   * Net = sellReleased - buyReleased.
   *   net >  threshold → pause sell (sold too much without buying back)
   *   net < -threshold → pause buy  (bought too much without selling)
   *   within range     → unpause both
   */
  private checkImbalance(): void {
    const threshold = this.config.imbalanceThresholdUsdt;
    if (threshold <= 0) return; // disabled

    const sellVol = this.releasedVolume.get('sell') ?? 0;
    const buyVol = this.releasedVolume.get('buy') ?? 0;
    const net = sellVol - buyVol;

    if (net > threshold && !this.imbalancePaused.get('sell')) {
      this.imbalancePaused.set('sell', true);
      log.warn({ net, sellVol, buyVol, threshold }, 'Imbalance limit hit — pausing sell side until buy catches up');
      void this.bus.emit('ad:paused', { side: 'sell' as Side, reason: `Imbalance: sold ${net.toFixed(0)} USDT more than bought (limit ${threshold})` }, MODULE);
    } else if (net <= threshold && this.imbalancePaused.get('sell')) {
      this.imbalancePaused.set('sell', false);
      log.info({ net, sellVol, buyVol }, 'Sell side imbalance resolved — resuming');
      void this.bus.emit('ad:resumed', { side: 'sell' as Side }, MODULE);
    }

    if (net < -threshold && !this.imbalancePaused.get('buy')) {
      this.imbalancePaused.set('buy', true);
      log.warn({ net, sellVol, buyVol, threshold }, 'Imbalance limit hit — pausing buy side until sell catches up');
      void this.bus.emit('ad:paused', { side: 'buy' as Side, reason: `Imbalance: bought ${Math.abs(net).toFixed(0)} USDT more than sold (limit ${threshold})` }, MODULE);
    } else if (net >= -threshold && this.imbalancePaused.get('buy')) {
      this.imbalancePaused.set('buy', false);
      log.info({ net, sellVol, buyVol }, 'Buy side imbalance resolved — resuming');
      void this.bus.emit('ad:resumed', { side: 'buy' as Side }, MODULE);
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime control
  // ---------------------------------------------------------------------------

  setPaused(side: Side, paused: boolean): void {
    this.pausedSides.set(side, paused);
    log.info({ side, paused }, 'Ad side pause state updated');
  }

  setRepriceEnabled(enabled: boolean): void {
    this.repriceEnabled = enabled;
    log.info({ repriceEnabled: enabled }, 'Reprice mode updated');
  }

  updateConfig(config: PricingConfig): void {
    this.config = config;
    log.info({ config }, 'AdManager config updated');
  }

  setEngine(engine: RepricingEngine): void {
    this.engine = engine;
    log.info('Repricing engine connected');
  }

  // ---------------------------------------------------------------------------
  // Polling lifecycle
  // ---------------------------------------------------------------------------

  start(intervalMs: number): void {
    if (this.intervalHandle !== null) {
      log.warn('AdManager already running');
      return;
    }

    log.info({ intervalMs }, 'Starting AdManager');
    void this.tick();
    this.intervalHandle = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      log.info('AdManager stopped');
    }
  }

  restart(intervalMs: number): void {
    this.stop();
    this.start(intervalMs);
    log.info({ intervalMs }, 'AdManager restarted with new interval');
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getActiveAds(): Map<Side, ActiveAd> {
    return this.activeAds;
  }

  getImbalance(): { sellVol: number; buyVol: number; net: number; threshold: number; pausedSide: Side | null } {
    const sellVol = this.releasedVolume.get('sell') ?? 0;
    const buyVol = this.releasedVolume.get('buy') ?? 0;
    const net = sellVol - buyVol;
    const pausedSide = this.imbalancePaused.get('sell') ? 'sell' as Side
      : this.imbalancePaused.get('buy') ? 'buy' as Side
      : null;
    return { sellVol, buyVol, net, threshold: this.config.imbalanceThresholdUsdt, pausedSide };
  }
}
