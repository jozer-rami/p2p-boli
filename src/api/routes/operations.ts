import { Router } from 'express';
import type { Side } from '../../event-bus.js';

export interface OperationsDeps {
  adManager: {
    getImbalance: () => {
      sellVol: number;
      buyVol: number;
      net: number;
      threshold: number;
      pausedSide: Side | null;
    };
    getActiveAds: () => Map<Side, { side: Side; price: number; amountUsdt: number }>;
  };
  getLastRepricingResult: () => {
    action: string;
    buyPrice: number;
    sellPrice: number;
    spread: number;
    position: { buy: number; sell: number };
    filteredCompetitors: { buy: number; sell: number };
    mode: string;
    reason: string;
  } | null;
}

export function createOperationsRouter(deps: OperationsDeps): Router {
  const router = Router();

  router.get('/operations', (_req, res) => {
    const imbalance = deps.adManager.getImbalance();
    const activeAds = deps.adManager.getActiveAds();

    const sellAd = activeAds.get('sell');
    const buyAd = activeAds.get('buy');

    const rp = deps.getLastRepricingResult();
    const repricing = rp ? {
      action: rp.action,
      buyPrice: rp.buyPrice,
      sellPrice: rp.sellPrice,
      spread: rp.spread,
      position: rp.position,
      filteredCompetitors: rp.filteredCompetitors,
      mode: rp.mode,
      reason: rp.reason,
    } : null;

    res.json({
      imbalance,
      ads: {
        sell: sellAd ? { price: sellAd.price, amountUsdt: sellAd.amountUsdt } : null,
        buy: buyAd ? { price: buyAd.price, amountUsdt: buyAd.amountUsdt } : null,
      },
      repricing,
    });
  });

  return router;
}
