import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOperationsRouter } from '../../src/api/routes/operations.js';

function createMockDeps(overrides: Record<string, any> = {}) {
  return {
    adManager: {
      getImbalance: vi.fn().mockReturnValue({
        sellVol: 200, buyVol: 100, net: 100, threshold: 300, pausedSide: null,
      }),
      getActiveAds: vi.fn().mockReturnValue(new Map([
        ['sell', { bybitAdId: 'a1', side: 'sell', price: 9.35, amountUsdt: 150, bankAccountId: 1 }],
        ['buy', { bybitAdId: 'a2', side: 'buy', price: 9.31, amountUsdt: 300, bankAccountId: 1 }],
      ])),
    },
    getLastRepricingResult: vi.fn().mockReturnValue({
      action: 'reprice',
      buyPrice: 9.31,
      sellPrice: 9.35,
      spread: 0.04,
      position: { buy: 3, sell: 2 },
      filteredCompetitors: { buy: 1, sell: 2 },
      mode: 'conservative',
      reason: '',
    }),
    ...overrides,
  };
}

function buildApp(deps = createMockDeps()) {
  const app = express();
  app.use('/api', createOperationsRouter(deps));
  return { app, deps };
}

describe('Operations API', () => {
  it('GET /api/operations returns full response', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(200);

    expect(res.body.imbalance).toEqual({
      sellVol: 200, buyVol: 100, net: 100, threshold: 300, pausedSide: null,
    });
    expect(res.body.ads.sell).toEqual({ price: 9.35, amountUsdt: 150 });
    expect(res.body.ads.buy).toEqual({ price: 9.31, amountUsdt: 300 });
    expect(res.body.repricing.action).toBe('reprice');
    expect(res.body.repricing.spread).toBe(0.04);
  });

  it('returns null repricing when engine has not run', async () => {
    const { app } = buildApp(createMockDeps({
      getLastRepricingResult: vi.fn().mockReturnValue(null),
    }));
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(200);
    expect(res.body.repricing).toBeNull();
  });

  it('returns null ads when none active', async () => {
    const { app } = buildApp(createMockDeps({
      adManager: {
        getImbalance: vi.fn().mockReturnValue({ sellVol: 0, buyVol: 0, net: 0, threshold: 300, pausedSide: null }),
        getActiveAds: vi.fn().mockReturnValue(new Map()),
      },
    }));
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(200);
    expect(res.body.ads.sell).toBeNull();
    expect(res.body.ads.buy).toBeNull();
  });

  it('reflects imbalance paused side', async () => {
    const { app } = buildApp(createMockDeps({
      adManager: {
        getImbalance: vi.fn().mockReturnValue({ sellVol: 400, buyVol: 50, net: 350, threshold: 300, pausedSide: 'sell' }),
        getActiveAds: vi.fn().mockReturnValue(new Map()),
      },
    }));
    const res = await request(app).get('/api/operations');
    expect(res.body.imbalance.pausedSide).toBe('sell');
    expect(res.body.imbalance.net).toBe(350);
  });
});
