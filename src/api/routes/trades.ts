// src/api/routes/trades.ts
import { Router } from 'express';
import { gte, desc } from 'drizzle-orm';
import { trades, dailyPnl } from '../../db/schema.js';
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

    const tradeRows = await deps.db
      .select()
      .from(trades)
      .where(gte(trades.createdAt, startDate))
      .orderBy(desc(trades.createdAt))
      .all();

    // Current period P&L
    const pnlRows = await deps.db
      .select()
      .from(dailyPnl)
      .where(gte(dailyPnl.date, startDate))
      .all();

    const summary = {
      tradesCount: pnlRows.reduce((sum, r) => sum + r.tradesCount, 0),
      volumeUsdt: pnlRows.reduce((sum, r) => sum + r.volumeUsdt, 0),
      profitBob: pnlRows.reduce((sum, r) => sum + r.profitBob, 0),
    };

    // Previous period P&L for comparison
    const prevPnlRows = await deps.db
      .select()
      .from(dailyPnl)
      .where(gte(dailyPnl.date, prevStartDate))
      .all();
    // Filter to only include rows before the current period
    const prevOnly = prevPnlRows.filter((r) => r.date < startDate);

    const previousPeriod = {
      tradesCount: prevOnly.reduce((sum, r) => sum + r.tradesCount, 0),
      volumeUsdt: prevOnly.reduce((sum, r) => sum + r.volumeUsdt, 0),
      profitBob: prevOnly.reduce((sum, r) => sum + r.profitBob, 0),
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
