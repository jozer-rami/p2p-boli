// src/simulator/mocks/mock-bybit-client.ts

interface AdLogEntry {
  action: 'create' | 'reprice' | 'cancel';
  adId: string;
  side?: string;
  price?: number;
  amount?: number;
  timestamp: number;
}

interface CreateAdParams {
  side: string;
  price: string;
  amount: string;
  currencyId: string;
  fiatId: string;
  paymentIds: string[];
}

/**
 * BybitClient-compatible mock that tracks ad operations in memory.
 * Does not make any real API calls.
 */
export class MockBybitClient {
  private adLog: AdLogEntry[] = [];
  private activeAds = new Map<string, { side: string; price: number; amount: number }>();
  private nextAdId = 1;
  private dryRun = false;

  async createAd(params: CreateAdParams): Promise<string> {
    const adId = `mock-ad-${this.nextAdId++}`;
    this.activeAds.set(adId, {
      side: params.side,
      price: parseFloat(params.price),
      amount: parseFloat(params.amount),
    });
    this.adLog.push({
      action: 'create',
      adId,
      side: params.side,
      price: parseFloat(params.price),
      amount: parseFloat(params.amount),
      timestamp: Date.now(),
    });
    return adId;
  }

  async updateAd(adId: string, price: number, amount: number): Promise<void> {
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
      timestamp: Date.now(),
    });
  }

  async cancelAd(adId: string): Promise<void> {
    this.activeAds.delete(adId);
    this.adLog.push({
      action: 'cancel',
      adId,
      timestamp: Date.now(),
    });
  }

  async getOnlineAds(): Promise<unknown[]> {
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
