import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOrdersRouter } from '../../src/api/routes/orders.js';

const mockOrder = {
  id: '123',
  side: 'sell' as const,
  amount: 150,
  price: 9.35,
  totalBob: 1402.5,
  status: 'payment_marked' as const,
  counterpartyId: 'cp1',
  counterpartyName: 'bob',
  bankAccountId: 1,
  createdAt: Date.now(),
  autoCancelAt: null,
};

function createMockDeps() {
  return {
    orderHandler: {
      getTrackedOrders: vi.fn(() => new Map([['123', mockOrder]])),
      releaseOrder: vi.fn(async () => {}),
    },
    bybitClient: {
      getOrderMessages: vi.fn(async () => [
        { content: 'hi', contentType: 'str', sendTime: 1000, fromUserId: 'u1', roleType: 'user', nickName: 'bob' },
      ]),
    },
    bus: {
      emit: vi.fn(async () => {}),
    },
    bankManager: {
      getAccountById: vi.fn((id: number) => id === 1 ? { id: 1, name: 'Banco Union' } : undefined),
    },
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(() => undefined),
          })),
        })),
      })),
    },
  };
}

describe('Orders API', () => {
  function buildApp(deps = createMockDeps()) {
    const app = express();
    app.use(express.json());
    app.use('/api', createOrdersRouter(deps as any));
    return { app, deps };
  }

  it('GET /api/orders returns pending orders', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('123');
  });

  it('GET /api/orders/:id returns single order with bankAccountName', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/orders/123');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('123');
    expect(res.body.bankAccountName).toBe('Banco Union');
  });

  it('GET /api/orders/:id returns 404 for unknown order', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/orders/unknown');
    expect(res.status).toBe(404);
  });

  it('GET /api/orders/:id/chat returns messages', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/orders/123/chat');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].content).toBe('hi');
  });

  it('POST /api/orders/:id/release requires confirm: true', async () => {
    const { app, deps } = buildApp();
    const res = await request(app).post('/api/orders/123/release').send({});
    expect(res.status).toBe(400);
    expect(deps.orderHandler.releaseOrder).not.toHaveBeenCalled();
  });

  it('POST /api/orders/:id/release succeeds with confirm: true', async () => {
    const { app, deps } = buildApp();
    const res = await request(app).post('/api/orders/123/release').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(deps.orderHandler.releaseOrder).toHaveBeenCalledWith('123');
  });

  it('POST /api/orders/:id/dispute emits dispute event', async () => {
    const { app, deps } = buildApp();
    const res = await request(app).post('/api/orders/123/dispute').send({});
    expect(res.status).toBe(200);
    expect(deps.bus.emit).toHaveBeenCalledWith('telegram:dispute', { orderId: '123' }, 'dashboard');
  });
});
