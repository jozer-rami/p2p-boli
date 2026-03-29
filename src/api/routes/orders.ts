import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { trades } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
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
    sendOrderMessage: (orderId: string, message: string) => Promise<void>;
    sendOrderImage: (orderId: string, filePath: string) => Promise<void>;
  };
  bus: {
    emit: (event: string, payload: any, module: string) => Promise<void>;
  };
  bankManager: {
    getAccountById: (id: number) => { id: number; name: string } | undefined;
  };
  db: DB;
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

  router.get('/orders/:id', async (req, res) => {
    // Check in-memory tracked orders first
    const tracked = deps.orderHandler.getTrackedOrders().get(req.params.id);
    if (tracked) {
      res.json(trackedToResponse(tracked, resolveBankName(tracked.bankAccountId)));
      return;
    }

    // Fallback: look up completed trade in DB
    const dbTrade = await deps.db
      .select()
      .from(trades)
      .where(eq(trades.bybitOrderId, req.params.id))
      .get();

    if (!dbTrade) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const response: OrderResponse = {
      id: dbTrade.bybitOrderId,
      side: dbTrade.side as 'buy' | 'sell',
      amount: dbTrade.amountUsdt,
      price: dbTrade.priceBob,
      totalBob: dbTrade.totalBob,
      status: dbTrade.status,
      counterpartyId: dbTrade.counterpartyId ?? '',
      counterpartyName: dbTrade.counterpartyName ?? '',
      bankAccountId: dbTrade.bankAccountId ?? 0,
      bankAccountName: resolveBankName(dbTrade.bankAccountId ?? 0),
      createdAt: dbTrade.createdAt ? new Date(dbTrade.createdAt).getTime() : 0,
    };
    res.json(response);
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

  // Send text message to order chat
  router.post('/orders/:id/chat', async (req, res) => {
    const message = req.body?.message;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message required' });
      return;
    }
    try {
      await deps.bybitClient.sendOrderMessage(req.params.id, message);
      res.json({ success: true });
    } catch (err) {
      log.error({ err, orderId: req.params.id }, 'Failed to send chat message');
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  // Upload image to order chat
  router.post('/orders/:id/chat/image', async (req, res) => {
    try {
      // Read raw body as buffer
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length === 0) {
        res.status(400).json({ error: 'No image data' });
        return;
      }

      // Save to temp file
      const tmpDir = './data/tmp';
      mkdirSync(tmpDir, { recursive: true });
      const ext = (req.headers['content-type'] ?? '').includes('png') ? 'png' : 'jpg';
      const tmpPath = join(tmpDir, `upload-${Date.now()}.${ext}`);
      writeFileSync(tmpPath, buffer);

      await deps.bybitClient.sendOrderImage(req.params.id, tmpPath);
      res.json({ success: true });
    } catch (err) {
      log.error({ err, orderId: req.params.id }, 'Failed to upload chat image');
      res.status(500).json({ error: 'Failed to upload image' });
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
