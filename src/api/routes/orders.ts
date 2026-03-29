import { Router } from 'express';
import type { OrderResponse } from '../types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('api-orders');

export interface OrdersDeps {
  orderHandler: {
    getTrackedOrders: () => Map<string, any>;
    releaseOrder: (orderId: string) => Promise<void>;
  };
  bybitClient: {
    getOrderMessages: (orderId: string) => Promise<any[]>;
  };
  bus: {
    emit: (event: string, payload: any, module: string) => Promise<void>;
  };
  bankManager: {
    getAccountById: (id: number) => { id: number; name: string } | undefined;
  };
}

function trackedToResponse(order: any, bankName: string): OrderResponse {
  return {
    id: order.id,
    side: order.side,
    amount: order.amount,
    price: order.price,
    totalBob: order.totalBob,
    status: order.status,
    counterpartyId: order.counterpartyId,
    counterpartyName: order.counterpartyName,
    bankAccountId: order.bankAccountId,
    bankAccountName: bankName,
    createdAt: order.createdAt,
  };
}

export function createOrdersRouter(deps: OrdersDeps): Router {
  const router = Router();

  function resolveBankName(bankAccountId: number): string {
    const account = deps.bankManager.getAccountById(bankAccountId);
    return account?.name ?? '';
  }

  router.get('/orders', (_req, res) => {
    const tracked = deps.orderHandler.getTrackedOrders();
    const orders: OrderResponse[] = [];
    for (const order of tracked.values()) {
      if (order.status === 'released' || order.status === 'cancelled') continue;
      orders.push(trackedToResponse(order, resolveBankName(order.bankAccountId)));
    }
    res.json(orders);
  });

  router.get('/orders/:id', (req, res) => {
    const order = deps.orderHandler.getTrackedOrders().get(req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json(trackedToResponse(order, resolveBankName(order.bankAccountId)));
  });

  router.get('/orders/:id/chat', async (req, res) => {
    try {
      const messages = await deps.bybitClient.getOrderMessages(req.params.id);
      res.json(messages);
    } catch (err) {
      log.error({ err, orderId: req.params.id }, 'Failed to fetch chat messages');
      res.status(500).json({ error: 'Failed to fetch chat messages' });
    }
  });

  router.post('/orders/:id/release', async (req, res) => {
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: 'Release requires { confirm: true }' });
      return;
    }
    try {
      await deps.orderHandler.releaseOrder(req.params.id);
      res.json({ success: true, orderId: req.params.id });
    } catch (err) {
      log.error({ err, orderId: req.params.id }, 'Release failed');
      res.status(500).json({ error: 'Release failed' });
    }
  });

  router.post('/orders/:id/dispute', async (req, res) => {
    try {
      await deps.bus.emit('telegram:dispute', { orderId: req.params.id }, 'dashboard');
      res.json({ success: true, orderId: req.params.id });
    } catch (err) {
      log.error({ err, orderId: req.params.id }, 'Dispute failed');
      res.status(500).json({ error: 'Dispute failed' });
    }
  });

  return router;
}
