import { Router } from 'express';
import type { StatusResponse } from '../types.js';

export interface StatusDeps {
  emergencyStop: { getState: () => string };
  orderHandler: { getPendingCount: () => number };
  adManager: { getActiveAds: () => Map<string, { side: string; price: number; amountUsdt: number }> };
  priceMonitor: {
    getBybitPrices: () => { ask: number; bid: number } | undefined;
    getLatestPrices: () => Array<{ platform: string; ask: number; bid: number }>;
  };
  bankManager: { getAccounts: () => Array<{ id: number; name: string; balanceBob: number; status: string }> };
  getTodayProfit: () => Promise<{ tradesCount: number; profitBob: number; volumeUsdt: number }>;
  bybitUserId: string;
}

export function createStatusRouter(deps: StatusDeps): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    const bybitPrices = deps.priceMonitor.getBybitPrices();
    const allPrices = deps.priceMonitor.getLatestPrices();
    const fallback = allPrices[0];
    const ask = bybitPrices?.ask ?? fallback?.ask ?? 0;
    const bid = bybitPrices?.bid ?? fallback?.bid ?? 0;
    const ads = deps.adManager.getActiveAds();

    const response: StatusResponse = {
      botState: deps.emergencyStop.getState(),
      pendingOrders: deps.orderHandler.getPendingCount(),
      activeAds: Array.from(ads.values()).map((ad) => ({
        side: ad.side as 'buy' | 'sell',
        price: ad.price,
        amountUsdt: ad.amountUsdt,
      })),
      prices: { ask, bid },
      bankAccounts: deps.bankManager.getAccounts().map((a) => ({
        id: a.id,
        name: a.name,
        balanceBob: a.balanceBob,
        status: a.status,
      })),
      todayProfit: await deps.getTodayProfit(),
      bybitUserId: deps.bybitUserId,
    };

    res.json(response);
  });

  return router;
}
