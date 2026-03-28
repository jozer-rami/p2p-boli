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
/** Payment method IDs should come from config in a real deployment; hard-coded here for MVP */
const PAYMENT_METHOD_IDS: string[] = [];

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
      const bybitAds = await this.bybit.getPersonalAds();

      for (const ad of bybitAds) {
        // Only track active ads
        if (ad.status !== '1' && ad.status !== 'active') continue;

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

    const pricing = calculatePricing(this.latestPrices, this.config);

    const sides: Side[] = ['buy', 'sell'];
    for (const side of sides) {
      const price = side === 'buy' ? pricing.buyPrice : pricing.sellPrice;
      const pricingPaused = side === 'buy' ? pricing.paused.buy : pricing.paused.sell;
      const manualPaused = this.pausedSides.get(side) ?? false;
      const shouldPause = pricingPaused || manualPaused;

      const reason = pricing.paused.reason;

      if (pricingPaused && reason) {
        log.warn({ side, reason }, 'Pricing pause triggered');
        if (reason === 'spread inversion') {
          await this.bus.emit('ad:spread-inversion', {
            buyPrice: pricing.buyPrice,
            sellPrice: pricing.sellPrice,
          }, MODULE);
        } else {
          await this.bus.emit('ad:paused', { side, reason }, MODULE);
        }
      }

      await this.manageSide(side, price, shouldPause);
    }
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
      // Reprice only if the price has meaningfully changed (> 0.0001 BOB)
      if (Math.abs(existing.price - price) > 0.0001) {
        try {
          await this.bybit.updateAd(existing.bybitAdId, price, existing.amountUsdt);

          const oldPrice = existing.price;
          existing.price = price;

          // Persist updated price to DB
          await this.db
            .update(ads)
            .set({ price, updatedAt: new Date().toISOString() })
            .where(eq(ads.bybitAdId, existing.bybitAdId));

          await this.bus.emit(
            'ad:repriced',
            { adId: existing.bybitAdId, side, oldPrice, newPrice: price },
            MODULE,
          );

          log.info({ side, adId: existing.bybitAdId, oldPrice, newPrice: price }, 'Ad repriced');
        } catch (err) {
          log.error({ err, side }, 'Failed to reprice ad');
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
