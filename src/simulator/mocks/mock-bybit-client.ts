// src/simulator/mocks/mock-bybit-client.ts

import type { Side } from '../../event-bus.js';

interface AdLogEntry {
  action: 'create' | 'reprice' | 'cancel';
  adId: string;
  side?: string;
  price?: number;
  amount?: number;
  timestamp: number;
}

/**
 * Params accepted by createAd — union-compatible with both the real
 * BybitAdParams (used by AdManager) and the simpler test shape.
 */
interface CreateAdParams {
  side: string;
  price: string | number;
  amount: string | number;
  currencyId?: string;
  fiatCurrencyId?: string;
  fiatId?: string;
  paymentMethodIds?: string[];
  paymentIds?: string[];
  remark?: string;
}

interface MockAd {
  id: string;
  side: Side;
  price: number;
  amount: number;
  status: string;
}

/**
 * BybitClient-compatible mock that tracks ad operations in memory.
 * Does not make any real API calls.
 *
 * The method signatures match those called by the real PriceMonitor,
 * AdManager, and EmergencyStop modules so the mock can be used as
 * `BybitClient` via type-casting.
 */
export class MockBybitClient {
  private adLog: AdLogEntry[] = [];
  private activeAds = new Map<string, { side: string; price: number; amount: number }>();
  private nextAdId = 1;
  private dryRun = false;
  private timeMs = 0;

  setTime(ms: number): void {
    this.timeMs = ms;
  }

  async createAd(params: CreateAdParams): Promise<string> {
    const adId = `mock-ad-${this.nextAdId++}`;
    const price = typeof params.price === 'string' ? parseFloat(params.price) : params.price;
    const amount = typeof params.amount === 'string' ? parseFloat(params.amount) : params.amount;
    this.activeAds.set(adId, {
      side: params.side,
      price,
      amount,
    });
    this.adLog.push({
      action: 'create',
      adId,
      side: params.side,
      price,
      amount,
      timestamp: this.timeMs,
    });
    return adId;
  }

  async updateAd(adId: string, price: number, amount: number, _paymentIds?: string[]): Promise<void> {
    const ad = this.activeAds.get(adId);
    if (ad) {
      ad.price = price;
      ad.amount = amount;
    }
    this.adLog.push({
      action: 'reprice',
      adId,
      price,
      amount,
      timestamp: this.timeMs,
    });
  }

  async cancelAd(adId: string): Promise<void> {
    this.activeAds.delete(adId);
    this.adLog.push({
      action: 'cancel',
      adId,
      timestamp: this.timeMs,
    });
  }

  /**
   * Returns empty ads by default — AdManager/PriceMonitor will fall back
   * to CriptoYa pricing when no online ads are available.
   */
  async getOnlineAds(_side?: string, _currencyId?: string, _fiatId?: string): Promise<MockAd[]> {
    return [];
  }

  /** Returns empty — no existing personal ads in simulation */
  async getPersonalAds(): Promise<MockAd[]> {
    return [];
  }

  async getPaymentMethods(): Promise<Array<{ id: string; bankName: string; accountNo: string; realName: string }>> {
    return [{ id: '1', bankName: 'MockBank', accountNo: '000', realName: 'Test' }];
  }

  async getBalance(): Promise<{ free: string; locked: string }> {
    return { free: '10000', locked: '0' };
  }

  async getPendingOrders(): Promise<unknown[]> {
    return [];
  }

  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  isDryRun(): boolean {
    return this.dryRun;
  }

  getAdLog(): AdLogEntry[] {
    return [...this.adLog];
  }

  getActiveAds(): Map<string, { side: string; price: number; amount: number }> {
    return new Map(this.activeAds);
  }

  clearLog(): void {
    this.adLog = [];
  }
}
