import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { WebSocketBroadcaster } from './ws.js';
import { createStatusRouter } from './routes/status.js';
import { createOrdersRouter } from './routes/orders.js';
import { createTradesRouter } from './routes/trades.js';
import { createPricesRouter } from './routes/prices.js';
import { createModuleLogger } from '../utils/logger.js';
import type { EventBus } from '../event-bus.js';
import type { DB } from '../db/index.js';

const log = createModuleLogger('api');

export interface ApiDeps {
  bus: EventBus;
  db: DB;
  orderHandler: any;
  adManager: any;
  priceMonitor: any;
  bankManager: any;
  emergencyStop: any;
  bybitClient: any;
  getTodayProfit: () => Promise<{ tradesCount: number; profitBob: number; volumeUsdt: number }>;
  bybitUserId: string;
}

export function createApiServer(deps: ApiDeps) {
  const app = express();
  app.use(express.json());

  // Mount API routes
  app.use('/api', createStatusRouter({
    emergencyStop: deps.emergencyStop,
    orderHandler: deps.orderHandler,
    adManager: deps.adManager,
    priceMonitor: deps.priceMonitor,
    bankManager: deps.bankManager,
    getTodayProfit: deps.getTodayProfit,
    bybitUserId: deps.bybitUserId,
  }));
  app.use('/api', createOrdersRouter({
    orderHandler: deps.orderHandler,
    bybitClient: deps.bybitClient,
    bus: deps.bus as any,
    bankManager: deps.bankManager,
  }));
  app.use('/api', createTradesRouter({ db: deps.db }));
  app.use('/api', createPricesRouter({ priceMonitor: deps.priceMonitor }));

  // Serve built React dashboard in production
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dashboardDist = join(__dirname, '../../dashboard/dist');
  const indexHtml = join(dashboardDist, 'index.html');
  if (existsSync(dashboardDist) && existsSync(indexHtml)) {
    app.use(express.static(dashboardDist));
    // SPA fallback — only for non-API GET requests
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(indexHtml);
    });
    log.info({ path: dashboardDist }, 'Serving dashboard static files');
  }

  // HTTP + WebSocket server
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const broadcaster = new WebSocketBroadcaster(deps.bus);

  wss.on('connection', (ws) => {
    broadcaster.addClient(ws);
  });

  return server;
}
