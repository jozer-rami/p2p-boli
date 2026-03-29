import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createStatusRouter } from '../../src/api/routes/status.js';

function createMockDeps() {
  return {
    emergencyStop: { getState: vi.fn(() => 'running') },
    orderHandler: { getPendingCount: vi.fn(() => 1) },
    adManager: {
      getActiveAds: vi.fn(() => new Map([
        ['sell', { side: 'sell', price: 9.35, amountUsdt: 500, bybitAdId: 'x', bankAccountId: null }],
      ])),
    },
    priceMonitor: {
      getBybitPrices: vi.fn(() => ({ ask: 9.35, bid: 9.20, platform: 'bybit', totalAsk: 0, totalBid: 0, time: 0 })),
    },
    bankManager: {
      getAccounts: vi.fn(() => [
        { id: 1, name: 'Banco Union', balanceBob: 12450, status: 'active', bank: 'BU', accountHint: '4521', dailyVolume: 0, dailyLimit: 0, monthlyVolume: 0, priority: 0, qrCodePath: null, paymentMessage: null },
      ]),
    },
    getTodayProfit: vi.fn(async () => ({ tradesCount: 3, profitBob: 45.2, volumeUsdt: 450 })),
    bybitUserId: '139499611',
  };
}

describe('GET /api/status', () => {
  it('returns full status response', async () => {
    const deps = createMockDeps();
    const app = express();
    app.use('/api', createStatusRouter(deps as any));

    const res = await request(app).get('/api/status');

    expect(res.status).toBe(200);
    expect(res.body.botState).toBe('running');
    expect(res.body.pendingOrders).toBe(1);
    expect(res.body.activeAds).toHaveLength(1);
    expect(res.body.activeAds[0].side).toBe('sell');
    expect(res.body.prices.ask).toBe(9.35);
    expect(res.body.bankAccounts).toHaveLength(1);
    expect(res.body.todayProfit.profitBob).toBe(45.2);
    expect(res.body.bybitUserId).toBe('139499611');
  });
});
