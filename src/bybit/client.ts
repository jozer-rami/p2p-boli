import { RestClientV5 } from 'bybit-api';
import { withRetry } from '../utils/retry.js';
import { createModuleLogger } from '../utils/logger.js';
import type { Side } from '../event-bus.js';
import type { BybitAdParams, BybitAd, BybitOrder, BybitBalance } from './types.js';

const log = createModuleLogger('bybit-client');

const RETRY_OPTIONS = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  shouldRetry: (err: Error) => {
    const msg = err.message;
    return !msg.includes('401') && !msg.includes('403');
  },
};

export class BybitClient {
  private readonly client: RestClientV5;

  constructor(apiKey: string, apiSecret: string, testnet = false) {
    this.client = new RestClientV5({ key: apiKey, secret: apiSecret, testnet });
  }

  /**
   * Get public online ads for a given side/currency pair.
   * side: 'buy' maps to '1' (buy ads), 'sell' maps to '0' (sell ads)
   */
  async getOnlineAds(side: Side, currencyId: string, fiatId: string): Promise<BybitAd[]> {
    return withRetry(async () => {
      const res = await this.client.getP2POnlineAds({
        tokenId: currencyId,
        currencyId: fiatId,
        side: side === 'buy' ? '1' : '0',
      });

      if (res.retCode !== 0) {
        throw new Error(`getOnlineAds failed: ${res.retMsg} (code ${res.retCode})`);
      }

      const items = res.result?.items ?? [];
      return items.map((ad) => ({
        id: ad.id,
        side: ad.side === '1' ? 'buy' : 'sell' as Side,
        price: parseFloat(ad.price),
        amount: parseFloat(ad.lastQuantity),
        status: String(ad.status),
      }));
    }, RETRY_OPTIONS);
  }

  /**
   * Get your own personal P2P ads.
   */
  async getPersonalAds(): Promise<BybitAd[]> {
    return withRetry(async () => {
      const res = await this.client.getP2PPersonalAds({} as any);

      if (res.retCode !== 0) {
        throw new Error(`getPersonalAds failed: ${res.retMsg} (code ${res.retCode})`);
      }

      const items = res.result?.items ?? [];
      return items.map((ad) => ({
        id: ad.id,
        side: ad.side === 1 ? 'buy' : 'sell' as Side,
        price: parseFloat(ad.price),
        amount: parseFloat(ad.lastQuantity),
        status: String(ad.status),
      }));
    }, RETRY_OPTIONS);
  }

  /**
   * Create a new P2P advertisement.
   */
  async createAd(params: BybitAdParams): Promise<string> {
    return withRetry(async () => {
      const res = await this.client.createP2PAd({
        tokenId: params.currencyId,
        currencyId: params.fiatCurrencyId,
        side: params.side === 'buy' ? '1' : '0',
        priceType: '0',
        premium: '0',
        price: String(params.price),
        minAmount: '1',
        maxAmount: String(params.amount * params.price),
        remark: params.remark ?? '',
        tradingPreferenceSet: {},
        paymentIds: params.paymentMethodIds,
        quantity: String(params.amount),
        paymentPeriod: '15',
        itemType: 'ORIGIN',
      } as any);

      if (res.retCode !== 0) {
        throw new Error(`createAd failed: ${res.retMsg} (code ${res.retCode})`);
      }

      const adId = res.result?.itemId;
      if (!adId) {
        throw new Error('createAd: no itemId in response');
      }

      log.info({ adId, side: params.side, price: params.price }, 'P2P ad created');
      return adId;
    }, RETRY_OPTIONS);
  }

  /**
   * Update (reprice) an existing P2P ad.
   */
  async updateAd(adId: string, price: number, amount: number): Promise<void> {
    return withRetry(async () => {
      const res = await this.client.updateP2PAd({
        id: adId,
        priceType: '0',
        premium: '0',
        price: String(price),
        minAmount: '1',
        maxAmount: String(amount * price),
        remark: '',
        tradingPreferenceSet: {},
        paymentIds: [],
        actionType: 'MODIFY',
        quantity: String(amount),
        paymentPeriod: '15',
      } as any);

      if (res.retCode !== 0) {
        throw new Error(`updateAd failed: ${res.retMsg} (code ${res.retCode})`);
      }

      log.info({ adId, price, amount }, 'P2P ad updated');
    }, RETRY_OPTIONS);
  }

  /**
   * Cancel (remove) a P2P advertisement.
   */
  async cancelAd(adId: string): Promise<void> {
    return withRetry(async () => {
      const res = await this.client.cancelP2PAd({ id: adId } as any);

      if (res.retCode !== 0) {
        throw new Error(`cancelAd failed: ${res.retMsg} (code ${res.retCode})`);
      }

      log.info({ adId }, 'P2P ad cancelled');
    }, RETRY_OPTIONS);
  }

  /**
   * Get all pending P2P orders.
   */
  async getPendingOrders(): Promise<BybitOrder[]> {
    return withRetry(async () => {
      const res = await this.client.getP2PPendingOrders({ page: 1, size: 50 });

      if (res.retCode !== 0) {
        throw new Error(`getPendingOrders failed: ${res.retMsg} (code ${res.retCode})`);
      }

      const items = res.result?.items ?? [];
      return items.map((order) => ({
        id: order.id,
        side: order.side === 1 ? 'buy' : 'sell' as Side,
        amount: parseFloat(order.amount),
        price: parseFloat(order.price),
        totalBob: parseFloat(order.amount) * parseFloat(order.price),
        status: String(order.status),
        counterpartyId: order.targetUserId,
        counterpartyName: order.targetNickName,
        createdAt: new Date(order.createDate).getTime(),
      }));
    }, RETRY_OPTIONS);
  }

  /**
   * Get the details of a single P2P order.
   */
  async getOrderDetail(orderId: string): Promise<BybitOrder> {
    return withRetry(async () => {
      const res = await this.client.getP2POrderDetail({ orderId } as any);

      if (res.retCode !== 0) {
        throw new Error(`getOrderDetail failed: ${res.retMsg} (code ${res.retCode})`);
      }

      const order = res.result;
      if (!order) {
        throw new Error(`getOrderDetail: no result for orderId ${orderId}`);
      }

      return {
        id: order.id,
        side: order.side === 1 ? 'buy' : 'sell' as Side,
        amount: parseFloat(order.amount),
        price: parseFloat(order.price),
        totalBob: parseFloat(order.amount) * parseFloat(order.price),
        status: String(order.status),
        counterpartyId: order.targetUserId,
        counterpartyName: order.targetNickName,
        createdAt: new Date(order.createDate).getTime(),
      };
    }, RETRY_OPTIONS);
  }

  /**
   * Mark a P2P order as paid (payment sent).
   */
  async markOrderAsPaid(orderId: string): Promise<void> {
    return withRetry(async () => {
      const res = await this.client.markP2POrderAsPaid({
        orderId,
        paymentType: '0',
        paymentId: '',
      } as any);

      if (res.retCode !== 0) {
        throw new Error(`markOrderAsPaid failed: ${res.retMsg} (code ${res.retCode})`);
      }

      log.info({ orderId }, 'P2P order marked as paid');
    }, RETRY_OPTIONS);
  }

  /**
   * Release crypto for a completed P2P order.
   * NO retry — releasing twice is dangerous.
   */
  async releaseOrder(orderId: string): Promise<void> {
    const res = await this.client.releaseP2POrder({ orderId } as any);

    if (res.retCode !== 0) {
      throw new Error(`releaseOrder failed: ${res.retMsg} (code ${res.retCode})`);
    }

    log.info({ orderId }, 'P2P order released');
  }

  /**
   * Get P2P account balance for the given coin.
   */
  async getBalance(coin: string): Promise<BybitBalance> {
    return withRetry(async () => {
      const res = await this.client.getP2PAccountCoinsBalance({
        accountType: 'FUND',
        coin,
      });

      if (res.retCode !== 0) {
        throw new Error(`getBalance failed: ${res.retMsg} (code ${res.retCode})`);
      }

      const balances = res.result?.balance ?? [];
      const entry = balances.find((b) => b.coin === coin);

      if (!entry) {
        return { coin, available: 0, frozen: 0 };
      }

      return {
        coin: entry.coin,
        available: parseFloat(entry.transferBalance),
        frozen: parseFloat(entry.walletBalance) - parseFloat(entry.transferBalance),
      };
    }, RETRY_OPTIONS);
  }
}
