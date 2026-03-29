// src/api/routes/trades.ts
import { Router } from 'express';
import { gte, desc, and, lt } from 'drizzle-orm';
import { trades } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import type { TradesWithSummary } from '../types.js';

export interface TradesDeps {
  db: DB;
}

function getRangeStartDate(range: string): string {
  const now = new Date();
  switch (range) {
    case '7d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d.toISOString().slice(0, 10);
    }
    case '30d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return d.toISOString().slice(0, 10);
    }
    default: // 'today'
      return now.toISOString().slice(0, 10);
  }
}

function getPreviousPeriodStartDate(range: string): string {
  const now = new Date();
  switch (range) {
    case '7d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 14);
      return d.toISOString().slice(0, 10);
    }
    case '30d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 60);
      return d.toISOString().slice(0, 10);
    }
    default: { // 'today' → previous period is yesterday
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    }
  }
}

export function createTradesRouter(deps: TradesDeps): Router {
  const router = Router();

  router.get('/trades', async (req, res) => {
    const range = (req.query.range as string) || 'today';
    const startDate = getRangeStartDate(range);
    const prevStartDate = getPreviousPeriodStartDate(range);

    // Current period trades
    const tradeRows = await deps.db
      .select()
      .from(trades)
      .where(gte(trades.createdAt, startDate))
      .orderBy(desc(trades.createdAt))
      .all();

    const completed = tradeRows.filter((t) => t.status === 'completed');
    const summary = {
      tradesCount: completed.length,
      volumeUsdt: completed.reduce((sum, t) => sum + t.amountUsdt, 0),
      profitBob: completed.reduce((sum, t) => sum + (t.spreadCaptured ?? 0) * t.totalBob, 0),
    };

    // Previous period trades for comparison
    const prevRows = await deps.db
      .select()
      .from(trades)
      .where(and(gte(trades.createdAt, prevStartDate), lt(trades.createdAt, startDate)))
      .all();

    const prevCompleted = prevRows.filter((t) => t.status === 'completed');
    const previousPeriod = {
      tradesCount: prevCompleted.length,
      volumeUsdt: prevCompleted.reduce((sum, t) => sum + t.amountUsdt, 0),
      profitBob: prevCompleted.reduce((sum, t) => sum + (t.spreadCaptured ?? 0) * t.totalBob, 0),
    };

    const response: TradesWithSummary = {
      trades: tradeRows.map((t) => ({
        id: t.id,
        bybitOrderId: t.bybitOrderId,
        side: t.side,
        amountUsdt: t.amountUsdt,
        priceBob: t.priceBob,
        totalBob: t.totalBob,
        spreadCaptured: t.spreadCaptured,
        counterpartyName: t.counterpartyName,
        status: t.status,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
      summary,
      previousPeriod,
    };

    res.json(response);
  });

  return router;
}
