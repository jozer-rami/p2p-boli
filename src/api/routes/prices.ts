// src/api/routes/prices.ts
import { Router } from 'express';
import type { PricesResponse } from '../types.js';

export interface PricesDeps {
  priceMonitor: {
    getLatestPrices: () => Array<{ platform: string; ask: number; bid: number; time: number }>;
  };
}

export function createPricesRouter(deps: PricesDeps): Router {
  const router = Router();

  router.get('/prices', (_req, res) => {
    const latest = deps.priceMonitor.getLatestPrices();
    const response: PricesResponse = {
      prices: latest.map((p) => ({
        platform: p.platform,
        ask: p.ask,
        bid: p.bid,
        time: p.time,
      })),
    };
    res.json(response);
  });

  return router;
}
