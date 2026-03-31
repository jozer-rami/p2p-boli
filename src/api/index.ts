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
import { createBanksRouter } from './routes/banks.js';
import { createSimulateRouter } from './routes/simulate.js';
import { createConfigRouter } from './routes/config.js';
import { createRepricingRouter } from './routes/repricing.js';
import { createBotConfigRouter } from './routes/bot-config.js';
import { createOperationsRouter } from './routes/operations.js';
import { createModuleLogger } from '../utils/logger.js';
import type { EventBus } from '../event-bus.js';
import type { DB } from '../db/index.js';
import type { RepricingEngine } from '../modules/repricing-engine/index.js';

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
  qrPreMessage: string;
  dryRun: boolean;
  repricingEngine: RepricingEngine;
  getConfig: (key: string) => string;
  setConfig: (key: string, value: string) => void;
  getLastRepricingResult: () => any;
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
    dryRun: deps.dryRun,
  }));
  app.use('/api', createOrdersRouter({
    orderHandler: deps.orderHandler,
    bybitClient: deps.bybitClient,
    bus: deps.bus as any,
    bankManager: deps.bankManager,
    db: deps.db,
  }));
  app.use('/api', createTradesRouter({ db: deps.db }));
  app.use('/api', createPricesRouter({ priceMonitor: deps.priceMonitor }));
  app.use('/api', createBanksRouter({ bankManager: deps.bankManager, db: deps.db }));
  app.use('/api', createSimulateRouter({
    bankManager: deps.bankManager,
    qrPreMessage: deps.qrPreMessage,
  }));
  app.use('/api', createConfigRouter({
    db: deps.db,
    priceMonitor: deps.priceMonitor,
  }));
  app.use('/api', createRepricingRouter({ engine: deps.repricingEngine }));
  app.use('/api', createBotConfigRouter({
    getConfig: deps.getConfig,
    setConfig: deps.setConfig,
    adManager: deps.adManager,
    orderHandler: deps.orderHandler,
    priceMonitor: deps.priceMonitor,
    emergencyStop: deps.emergencyStop,
  }));
  app.use('/api', createOperationsRouter({
    adManager: deps.adManager,
    getLastRepricingResult: deps.getLastRepricingResult,
  }));

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
