import { eq } from 'drizzle-orm';
import { ads } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import type { EventBus, PlatformPrices, Side } from '../../event-bus.js';
import type { BybitClient } from '../../bybit/client.js';
import { calculatePricing } from './pricing.js';
import type { PricingConfig } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';

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

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  async tick(): Promise<void> {
    if (this.latestPrices.length === 0) {
      log.debug('No prices yet — skipping tick');
      return;
    }

    // Check live Bybit order book spread before pricing
    try {
      const marketSpread = await this.checkBybitMarketSpread();
      if (marketSpread !== null && marketSpread < this.config.minSpread) {
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
    const spread = this.lastBybitAsk - this.lastBybitBid;
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

    if (shouldPause) {
      if (existing) {
        await this.removeAd(side);
        await this.bus.emit('ad:paused', { side, reason: 'paused' }, MODULE);
      }
      return;
    }

    if (existing) {
      const priceChanged = this.repriceEnabled && Math.abs(existing.price - price) > 0.0001;
      const quantityLow = existing.amountUsdt < this.config.tradeAmountUsdt * 0.5; // refill when below 50%
      const needsUpdate = priceChanged || quantityLow;

      if (needsUpdate) {
        try {
          const newAmount = quantityLow ? this.config.tradeAmountUsdt : existing.amountUsdt;
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

          if (quantityLow) {
            log.info({ side, adId: existing.bybitAdId, oldAmount: existing.amountUsdt, newAmount }, 'Ad quantity refilled');
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

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getActiveAds(): Map<Side, ActiveAd> {
    return this.activeAds;
  }
}
