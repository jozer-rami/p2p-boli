import { Router } from 'express';
import type { RepricingEngine } from '../../modules/repricing-engine/index.js';

export interface RepricingDeps {
  engine: RepricingEngine;
}

export function createRepricingRouter(deps: RepricingDeps): Router {
  const router = Router();

  router.get('/repricing/config', (_req, res) => {
    const config = deps.engine.getConfig();
    res.json({
      mode: config.mode,
      targetPosition: config.targetPosition,
      antiOscillationThreshold: config.antiOscillationThreshold,
      minSpread: config.minSpread,
      maxSpread: config.maxSpread,
      filters: config.filters,
    });
  });

  router.put('/repricing/config', (req, res) => {
    const body = req.body;
    const update: Record<string, any> = {};

    if (body.mode) update.mode = body.mode;
    if (body.targetPosition !== undefined) update.targetPosition = Number(body.targetPosition);
    if (body.antiOscillationThreshold !== undefined) update.antiOscillationThreshold = Number(body.antiOscillationThreshold);
    if (body.minSpread !== undefined) update.minSpread = Number(body.minSpread);
    if (body.maxSpread !== undefined) update.maxSpread = Number(body.maxSpread);
    if (body.filters) {
      const currentConfig = deps.engine.getConfig();
      update.filters = { ...currentConfig.filters, ...body.filters };
      if (typeof body.filters.merchantLevels === 'string') {
        update.filters.merchantLevels = body.filters.merchantLevels.split(',');
      }
    }

    deps.engine.updateConfig(update);
    res.json({ ok: true, config: deps.engine.getConfig() });
  });

  router.get('/repricing/status', (_req, res) => {
    const lastResult = deps.engine.getLastResult();
    if (!lastResult) {
      res.json({ action: 'none', reason: 'no cycle yet' });
      return;
    }
    res.json({
      action: lastResult.action,
      buyPrice: lastResult.buyPrice,
      sellPrice: lastResult.sellPrice,
      spread: lastResult.spread,
      position: lastResult.position,
      filteredCompetitors: lastResult.filteredCompetitors,
      mode: lastResult.mode,
      reason: lastResult.reason,
      excludedAggressive: lastResult.excludedAggressive,
    });
  });

  router.get('/repricing/orderbook', (_req, res) => {
    const book = deps.engine.getFilteredOrderBook();
    const lastResult = deps.engine.getLastResult();

    const formatSide = (ads: any[], side: string) =>
      [...ads]
        .sort((a: any, b: any) => side === 'sell' ? a.price - b.price : b.price - a.price)
        .map((ad: any, i: number) => ({
          rank: i + 1,
          price: ad.price,
          quantity: ad.quantity,
          nickName: ad.nickName,
          completionRate: ad.recentExecuteRate,
          orders: ad.recentOrderNum,
        }));

    res.json({
      sell: formatSide(book.sell, 'sell'),
      buy: formatSide(book.buy, 'buy'),
      excludedAggressive: lastResult?.excludedAggressive ?? [],
      totalFiltered: { sell: book.sell.length, buy: book.buy.length },
    });
  });

  return router;
}
