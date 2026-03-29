import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBanksRouter } from '../../src/api/routes/banks.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, mkdirSync: vi.fn(), writeFileSync: vi.fn(), unlinkSync: vi.fn(), existsSync: vi.fn(() => true) };
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
    paymentMessage: null,
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
    status: 'active',
    priority: 0,
    qrCodePath: null,
    paymentMessage: null,
  },
];

function createMockDeps() {
  return {
    bankManager: {
      getAccounts: vi.fn(() => mockAccounts),
      getAccountById: vi.fn((id: number) => mockAccounts.find((a) => a.id === id)),
      loadAccounts: vi.fn(async () => {}),
    },
    db: {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => {}),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: 3 }]),
        })),
      })),
    },
  };
}

function buildApp(deps = createMockDeps()) {
  const app = express();
  app.use(express.json());
  app.use('/api', createBanksRouter(deps as any));
  return { app, deps };
}

describe('Banks API', () => {
  it('GET /api/banks returns all bank accounts', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/banks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Banco Union Personal');
    expect(res.body[1].qrCodePath).toBeNull();
  });

  it('PUT /api/banks/:id/qr returns 404 for unknown bank', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .put('/api/banks/999/qr')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('fake-png-data'));
    expect(res.status).toBe(404);
  });

  it('PUT /api/banks/:id/qr returns 400 for empty body', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .put('/api/banks/1/qr')
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(0));
    expect(res.status).toBe(400);
  });

  it('PUT /api/banks/:id/qr saves file and updates DB', async () => {
    const { app, deps } = buildApp();
    const fakeImage = Buffer.from('fake-png-data');
    const res = await request(app)
      .put('/api/banks/1/qr')
      .set('Content-Type', 'image/png')
      .send(fakeImage);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.qrCodePath).toContain('banco-union-4521');
    expect(deps.db.update).toHaveBeenCalled();
    expect(deps.bankManager.loadAccounts).toHaveBeenCalled();
  });

  it('DELETE /api/banks/:id/qr returns 404 for unknown bank', async () => {
    const { app } = buildApp();
    const res = await request(app).delete('/api/banks/999/qr');
    expect(res.status).toBe(404);
  });

  it('DELETE /api/banks/:id/qr clears qrCodePath and reloads', async () => {
    const { app, deps } = buildApp();
    const res = await request(app).delete('/api/banks/1/qr');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deps.db.update).toHaveBeenCalled();
    expect(deps.bankManager.loadAccounts).toHaveBeenCalled();
  });

  it('POST /api/banks creates a new bank account', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .post('/api/banks')
      .send({
        name: 'Banco Sol',
        bank: 'banco-sol',
        accountHint: '1234',
        balanceBob: 5000,
        dailyLimit: 20000,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(3);
    expect(deps.db.insert).toHaveBeenCalled();
    expect(deps.bankManager.loadAccounts).toHaveBeenCalled();
  });

  it('POST /api/banks returns 400 for missing required fields', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/banks')
      .send({ name: 'Incomplete' });
    expect(res.status).toBe(400);
  });

  it('POST /api/banks accepts optional priority and paymentMessage', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .post('/api/banks')
      .send({
        name: 'Banco Sol',
        bank: 'banco-sol',
        accountHint: '1234',
        balanceBob: 5000,
        dailyLimit: 20000,
        priority: 5,
        paymentMessage: 'Pay here',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deps.db.insert).toHaveBeenCalled();
  });

  it('PATCH /api/banks/:id updates bank fields', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .patch('/api/banks/1')
      .send({ name: 'Banco Union Empresarial', dailyLimit: 80000 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deps.db.update).toHaveBeenCalled();
    expect(deps.bankManager.loadAccounts).toHaveBeenCalled();
  });

  it('PATCH /api/banks/:id returns 404 for unknown bank', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .patch('/api/banks/999')
      .send({ name: 'Updated' });
    expect(res.status).toBe(404);
  });

  it('PATCH /api/banks/:id returns 400 for empty body', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .patch('/api/banks/1')
      .send({});
    expect(res.status).toBe(400);
  });

  it('PATCH /api/banks/:id can toggle status to inactive', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .patch('/api/banks/1')
      .send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deps.db.update).toHaveBeenCalled();
  });
});
