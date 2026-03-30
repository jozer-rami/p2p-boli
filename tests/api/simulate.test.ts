import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSimulateRouter } from '../../src/api/routes/simulate.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

const mockAccounts = [
  {
    id: 1,
    name: 'Banco Union Personal',
    bank: 'banco-union',
    accountHint: '4521',
    balanceBob: 5000,
    dailyVolume: 1200,
    dailyLimit: 10000,
    monthlyVolume: 30000,
    status: 'active',
    priority: 1,
    qrCodePath: './data/qr/banco-union-4521.png',
    paymentMessage: 'Pagar a Banco Union ****4521',
  },
  {
    id: 2,
    name: 'Banco Mercantil',
    bank: 'banco-mercantil',
    accountHint: '7823',
    balanceBob: 3000,
    dailyVolume: 800,
    dailyLimit: 8000,
    monthlyVolume: 20000,
    status: 'inactive',
    priority: 0,
    qrCodePath: null,
    paymentMessage: null,
  },
];

function createMockDeps() {
  return {
    bankManager: {
      getAccountById: vi.fn((id: number) => mockAccounts.find((a) => a.id === id)),
    },
    qrPreMessage: 'Hola! En breve te enviaremos el codigo QR para realizar el pago.',
  };
}

function buildApp(deps = createMockDeps()) {
  const app = express();
  app.use(express.json());
  app.use('/api', createSimulateRouter(deps));
  return { app, deps };
}

describe('Simulate API', () => {
  it('GET /api/simulate/sell-order returns full message sequence', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/simulate/sell-order?bankAccountId=1');

    expect(res.status).toBe(200);
    expect(res.body.bankAccount).toEqual({
      name: 'Banco Union Personal',
      bank: 'banco-union',
      accountHint: '4521',
    });
    expect(res.body.messages).toHaveLength(3);
    expect(res.body.messages[0]).toMatchObject({ step: 1, type: 'text' });
    expect(res.body.messages[1]).toMatchObject({ step: 2, type: 'image', exists: true });
    expect(res.body.messages[2]).toMatchObject({ step: 3, type: 'text', content: 'Pagar a Banco Union ****4521' });
    expect(res.body.warnings).toEqual([]);
  });

  it('returns 400 when bankAccountId is missing', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/simulate/sell-order');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bankAccountId/);
  });

  it('returns 404 when bank account does not exist', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/simulate/sell-order?bankAccountId=999');
    expect(res.status).toBe(404);
  });

  it('includes warning when account is inactive', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/simulate/sell-order?bankAccountId=2');

    expect(res.status).toBe(200);
    expect(res.body.warnings).toContain('Account is inactive');
  });

  it('accepts custom amount and price params', async () => {
    const deps = createMockDeps();
    const { app } = buildApp(deps);
    const res = await request(app).get('/api/simulate/sell-order?bankAccountId=2&amount=200&price=7.00');

    expect(res.status).toBe(200);
    const lastMsg = res.body.messages[res.body.messages.length - 1];
    expect(lastMsg.content).toContain('1400.00 BOB');
  });

  it('skips image step when qrCodePath is null', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/simulate/sell-order?bankAccountId=2');

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages.every((m: any) => m.type !== 'image')).toBe(true);
  });
});
