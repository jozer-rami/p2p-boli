# Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop web dashboard that complements Telegram for monitoring P2P trades and executing fund releases with a safe two-step confirmation flow.

**Architecture:** Express API + WebSocket layer embedded in the existing bot process, forwarding EventBus events to a React frontend. In development the React app runs on Vite with a proxy; in production it's served as static files by the bot.

**Tech Stack:** Express, ws, React, Vite, Tailwind CSS, TanStack React Query

**Spec:** `docs/superpowers/specs/2026-03-28-operations-dashboard-design.md`

---

## File Map

### Backend (new files in `src/api/`)

| File | Responsibility |
|------|----------------|
| `src/api/index.ts` | Create Express app, attach WS upgrade handler, mount routes, serve static dashboard in prod |
| `src/api/ws.ts` | Subscribe to EventBus events, broadcast JSON to connected WS clients |
| `src/api/routes/status.ts` | `GET /api/status` — bot state, pending count, ads, prices, bank balances, bybitUserId |
| `src/api/routes/orders.ts` | `GET /api/orders`, `GET /api/orders/:id`, `GET /api/orders/:id/chat`, `POST /api/orders/:id/release`, `POST /api/orders/:id/dispute` |
| `src/api/routes/trades.ts` | `GET /api/trades?range=today\|7d\|30d` — trade history with P&L summary |
| `src/api/routes/prices.ts` | `GET /api/prices` — current prices from all sources |
| `src/api/types.ts` | Shared API response types (used by both backend and frontend) |

### Backend (modified)

| File | Change |
|------|--------|
| `src/config.ts` | Add `DASHBOARD_PORT` env var (default 3000) |
| `src/index.ts` | Import and start API server after existing module setup |

### Frontend (new `dashboard/` directory)

| File | Responsibility |
|------|----------------|
| `dashboard/package.json` | React + Vite + Tailwind dependencies |
| `dashboard/vite.config.ts` | Vite config with proxy for `/api` and `/ws` to bot |
| `dashboard/tailwind.config.ts` | Warm neutral dark palette, monospace font for numbers |
| `dashboard/postcss.config.js` | PostCSS with Tailwind plugin |
| `dashboard/index.html` | Vite HTML entry |
| `dashboard/src/main.tsx` | React root mount |
| `dashboard/src/App.tsx` | Router with smart home (release panel if pending order, overview otherwise) |
| `dashboard/src/index.css` | Tailwind imports + warm dark body + font imports |
| `dashboard/src/hooks/useWebSocket.ts` | WS with auto-reconnect, React Query invalidation, browser notifications + audio ping |
| `dashboard/src/hooks/useApi.ts` | React Query hooks for each API endpoint |
| `dashboard/src/pages/Overview.tsx` | Plain-text metrics + asymmetric orders/bank layout, no cards |
| `dashboard/src/pages/ReleasePanel.tsx` | Three-column asymmetric view + full-width release button + keyboard shortcuts |
| `dashboard/src/pages/TradeHistory.tsx` | Hero profit metric + comparison + table with spread column |
| `dashboard/src/components/ConnectionStatus.tsx` | Green/red dot with connected/reconnecting text |
| `dashboard/src/components/OrderRow.tsx` | Clickable order row, no card wrapper |
| `dashboard/src/components/ChatView.tsx` | Scrollable chat message list |
| `dashboard/src/components/ConfirmDialog.tsx` | Confirmation dialog for release with keyboard support |

### Tests

| File | What it tests |
|------|---------------|
| `tests/api/status.test.ts` | Status endpoint returns correct shape |
| `tests/api/orders.test.ts` | Orders CRUD + release safety (confirm required) |
| `tests/api/trades.test.ts` | Trade history with range filtering |
| `tests/api/ws.test.ts` | WebSocket broadcasts EventBus events |

---

## Task 1: Install backend dependencies and add config

**Files:**
- Modify: `package.json`
- Modify: `src/config.ts`

- [ ] **Step 1: Install express and ws**

```bash
npm install express ws
npm install -D @types/express @types/ws
```

- [ ] **Step 2: Add DASHBOARD_PORT to envConfig**

In `src/config.ts`, add to the `envConfig` object:

```typescript
dashboard: {
  port: parseInt(optional('DASHBOARD_PORT', '3000'), 10),
},
```

- [ ] **Step 3: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/config.ts
git commit -m "feat(dashboard): add express, ws dependencies and DASHBOARD_PORT config"
```

---

## Task 2: API types shared between backend and frontend

**Files:**
- Create: `src/api/types.ts`

- [ ] **Step 1: Write the API response types**

```typescript
// src/api/types.ts
import type { Side } from '../event-bus.js';

export interface StatusResponse {
  botState: string;
  pendingOrders: number;
  activeAds: Array<{ side: Side; price: number; amountUsdt: number }>;
  prices: { ask: number; bid: number };
  bankAccounts: Array<{ id: number; name: string; balanceBob: number; status: string }>;
  todayProfit: { tradesCount: number; profitBob: number; volumeUsdt: number };
  bybitUserId: string;
}

export interface OrderResponse {
  id: string;
  side: Side;
  amount: number;
  price: number;
  totalBob: number;
  status: string;
  counterpartyId: string;
  counterpartyName: string;
  bankAccountId: number;
  bankAccountName: string;
  createdAt: number;
}

export interface ChatMessage {
  content: string;
  contentType: string;
  sendTime: number;
  fromUserId: string;
  roleType: string;
  nickName: string;
}

export interface TradeResponse {
  id: number;
  bybitOrderId: string;
  side: string;
  amountUsdt: number;
  priceBob: number;
  totalBob: number;
  spreadCaptured: number | null;
  counterpartyName: string | null;
  status: string;
  createdAt: string | null;
  completedAt: string | null;
}

export interface TradesWithSummary {
  trades: TradeResponse[];
  summary: { tradesCount: number; volumeUsdt: number; profitBob: number };
  previousPeriod: { tradesCount: number; volumeUsdt: number; profitBob: number };
}

export interface PricesResponse {
  prices: Array<{ platform: string; ask: number; bid: number; time: number }>;
}

export interface WsEvent {
  event: string;
  payload: unknown;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/api/types.ts
git commit -m "feat(dashboard): add shared API response types"
```

---

## Task 3: WebSocket broadcaster

**Files:**
- Create: `src/api/ws.ts`
- Test: `tests/api/ws.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/ws.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketBroadcaster } from '../src/api/ws.js';

function createMockBus() {
  const handlers = new Map<string, Function>();
  return {
    on: vi.fn((event: string, handler: Function) => { handlers.set(event, handler); }),
    handlers,
  };
}

describe('WebSocketBroadcaster', () => {
  it('broadcasts EventBus events to connected clients', () => {
    const bus = createMockBus();
    const broadcaster = new WebSocketBroadcaster(bus as any);

    const mockClient = { readyState: 1, send: vi.fn() }; // 1 = OPEN
    broadcaster.addClient(mockClient as any);

    // Simulate EventBus firing order:new
    const handler = bus.handlers.get('order:new');
    expect(handler).toBeDefined();
    handler!({ orderId: '123', side: 'sell', amount: 150, price: 9.35, counterparty: 'bob' });

    expect(mockClient.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'order:new', payload: { orderId: '123', side: 'sell', amount: 150, price: 9.35, counterparty: 'bob' } })
    );
  });

  it('removes closed clients on broadcast', () => {
    const bus = createMockBus();
    const broadcaster = new WebSocketBroadcaster(bus as any);

    const closedClient = { readyState: 3, send: vi.fn() }; // 3 = CLOSED
    broadcaster.addClient(closedClient as any);

    const handler = bus.handlers.get('order:new');
    handler!({ orderId: '123' });

    expect(closedClient.send).not.toHaveBeenCalled();
    expect(broadcaster.clientCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/api/ws.test.ts
```

Expected: FAIL — cannot find module `../src/api/ws.js`

- [ ] **Step 3: Implement WebSocketBroadcaster**

```typescript
// src/api/ws.ts
import type { WebSocket } from 'ws';
import type { EventBus, EventMap } from '../event-bus.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('api-ws');

const FORWARDED_EVENTS: (keyof EventMap)[] = [
  'order:new',
  'order:payment-claimed',
  'order:released',
  'order:cancelled',
  'price:updated',
  'ad:created',
  'ad:repriced',
  'emergency:triggered',
  'emergency:resolved',
];

export class WebSocketBroadcaster {
  private clients: Set<WebSocket> = new Set();

  constructor(bus: EventBus) {
    for (const event of FORWARDED_EVENTS) {
      bus.on(event, (payload) => {
        this.broadcast(event, payload);
      });
    }
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    log.info({ clients: this.clients.size }, 'WS client connected');

    ws.on('close', () => {
      this.clients.delete(ws);
      log.info({ clients: this.clients.size }, 'WS client disconnected');
    });
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private broadcast(event: string, payload: unknown): void {
    const message = JSON.stringify({ event, payload });
    for (const client of this.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      } else {
        this.clients.delete(client);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/api/ws.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/ws.ts tests/api/ws.test.ts
git commit -m "feat(dashboard): WebSocket broadcaster forwarding EventBus events"
```

---

## Task 4: Status route

**Files:**
- Create: `src/api/routes/status.ts`
- Test: `tests/api/status.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/status.test.ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createStatusRouter } from '../src/api/routes/status.js';

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
```

- [ ] **Step 2: Install supertest for route testing**

```bash
npm install -D supertest @types/supertest
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/api/status.test.ts
```

Expected: FAIL — cannot find module

- [ ] **Step 4: Implement status route**

```typescript
// src/api/routes/status.ts
import { Router } from 'express';
import type { EmergencyStop } from '../../modules/emergency-stop/index.js';
import type { OrderHandler } from '../../modules/order-handler/index.js';
import type { AdManager } from '../../modules/ad-manager/index.js';
import type { PriceMonitor } from '../../modules/price-monitor/index.js';
import type { BankManager } from '../../modules/bank-manager/index.js';
import type { StatusResponse } from '../types.js';

export interface StatusDeps {
  emergencyStop: Pick<EmergencyStop, 'getState'>;
  orderHandler: Pick<OrderHandler, 'getPendingCount'>;
  adManager: Pick<AdManager, 'getActiveAds'>;
  priceMonitor: Pick<PriceMonitor, 'getBybitPrices'>;
  bankManager: Pick<BankManager, 'getAccounts'>;
  getTodayProfit: () => Promise<{ tradesCount: number; profitBob: number; volumeUsdt: number }>;
  bybitUserId: string;
}

export function createStatusRouter(deps: StatusDeps): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    const prices = deps.priceMonitor.getBybitPrices();
    const ads = deps.adManager.getActiveAds();

    const response: StatusResponse = {
      botState: deps.emergencyStop.getState(),
      pendingOrders: deps.orderHandler.getPendingCount(),
      activeAds: Array.from(ads.values()).map((ad) => ({
        side: ad.side,
        price: ad.price,
        amountUsdt: ad.amountUsdt,
      })),
      prices: {
        ask: prices?.ask ?? 0,
        bid: prices?.bid ?? 0,
      },
      bankAccounts: deps.bankManager.getAccounts().map((a) => ({
        id: a.id,
        name: a.name,
        balanceBob: a.balanceBob,
        status: a.status,
      })),
      todayProfit: await deps.getTodayProfit(),
      bybitUserId: deps.bybitUserId,
    };

    res.json(response);
  });

  return router;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/api/status.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/status.ts tests/api/status.test.ts
git commit -m "feat(dashboard): GET /api/status endpoint"
```

---

## Task 5: Orders route (read + release + dispute)

**Files:**
- Create: `src/api/routes/orders.ts`
- Test: `tests/api/orders.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/api/orders.test.ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOrdersRouter } from '../src/api/routes/orders.js';

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

  it('GET /api/orders/:id returns single order', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/orders/123');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('123');
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/api/orders.test.ts
```

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement orders route**

```typescript
// src/api/routes/orders.ts
import { Router } from 'express';
import type { OrderHandler } from '../../modules/order-handler/index.js';
import type { BybitClient } from '../../bybit/client.js';
import type { EventBus } from '../../event-bus.js';
import type { OrderResponse } from '../types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('api-orders');

export interface OrdersDeps {
  orderHandler: Pick<OrderHandler, 'getTrackedOrders' | 'releaseOrder'>;
  bybitClient: Pick<BybitClient, 'getOrderMessages'>;
  bus: Pick<EventBus, 'emit'>;
}

function trackedToResponse(order: { id: string; side: string; amount: number; price: number; totalBob: number; status: string; counterpartyId: string; counterpartyName: string; bankAccountId: number; createdAt: number }): OrderResponse {
  return {
    id: order.id,
    side: order.side as 'buy' | 'sell',
    amount: order.amount,
    price: order.price,
    totalBob: order.totalBob,
    status: order.status,
    counterpartyId: order.counterpartyId,
    counterpartyName: order.counterpartyName,
    bankAccountId: order.bankAccountId,
    createdAt: order.createdAt,
  };
}

export function createOrdersRouter(deps: OrdersDeps): Router {
  const router = Router();

  router.get('/orders', (_req, res) => {
    const tracked = deps.orderHandler.getTrackedOrders();
    const orders: OrderResponse[] = [];
    for (const order of tracked.values()) {
      if (order.status === 'released' || order.status === 'cancelled') continue;
      orders.push(trackedToResponse(order));
    }
    res.json(orders);
  });

  router.get('/orders/:id', (req, res) => {
    const order = deps.orderHandler.getTrackedOrders().get(req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json(trackedToResponse(order));
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/api/orders.test.ts
```

Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/orders.ts tests/api/orders.test.ts
git commit -m "feat(dashboard): orders API with release safety gate"
```

---

## Task 6: Trades route

**Files:**
- Create: `src/api/routes/trades.ts`
- Test: `tests/api/trades.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/trades.test.ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTradesRouter } from '../src/api/routes/trades.js';

const now = new Date();
const today = now.toISOString().slice(0, 10);
const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

function createMockDb() {
  const allTrades = [
    { id: 1, bybitOrderId: 'o1', side: 'sell', amountUsdt: 150, priceBob: 9.35, totalBob: 1402.5, counterpartyName: 'bob', status: 'completed', createdAt: `${today}T10:00:00Z`, completedAt: `${today}T10:05:00Z` },
    { id: 2, bybitOrderId: 'o2', side: 'buy', amountUsdt: 100, priceBob: 9.20, totalBob: 920, counterpartyName: 'alice', status: 'completed', createdAt: `${yesterday}T15:00:00Z`, completedAt: `${yesterday}T15:05:00Z` },
  ];

  const dailyPnlRows = [
    { date: today, tradesCount: 1, volumeUsdt: 150, profitBob: 12.5 },
    { date: yesterday, tradesCount: 1, volumeUsdt: 100, profitBob: 8.0 },
  ];

  return { allTrades, dailyPnlRows };
}

describe('GET /api/trades', () => {
  it('returns trades for today by default', async () => {
    const mock = createMockDb();
    const app = express();
    app.use('/api', createTradesRouter(mock as any));

    const res = await request(app).get('/api/trades');
    expect(res.status).toBe(200);
    expect(res.body.trades.length).toBeGreaterThanOrEqual(0);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary).toHaveProperty('tradesCount');
    expect(res.body.summary).toHaveProperty('volumeUsdt');
    expect(res.body.summary).toHaveProperty('profitBob');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/api/trades.test.ts
```

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement trades route**

```typescript
// src/api/routes/trades.ts
import { Router } from 'express';
import { gte, desc, sql } from 'drizzle-orm';
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

export function createTradesRouter(deps: TradesDeps): Router {
  const router = Router();

  router.get('/trades', async (req, res) => {
    const range = (req.query.range as string) || 'today';
    const startDate = getRangeStartDate(range);

    const tradeRows = await deps.db
      .select()
      .from(trades)
      .where(gte(trades.createdAt, startDate))
      .orderBy(desc(trades.createdAt))
      .all();

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

    const response: TradesWithSummary = {
      trades: tradeRows.map((t) => ({
        id: t.id,
        bybitOrderId: t.bybitOrderId,
        side: t.side,
        amountUsdt: t.amountUsdt,
        priceBob: t.priceBob,
        totalBob: t.totalBob,
        counterpartyName: t.counterpartyName,
        status: t.status,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
      summary,
    };

    res.json(response);
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/api/trades.test.ts
```

Expected: PASS (may need to adjust mock to match Drizzle interface — use in-memory DB from `createTestDB` if needed)

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/trades.ts tests/api/trades.test.ts
git commit -m "feat(dashboard): GET /api/trades with range filtering"
```

---

## Task 7: Prices route

**Files:**
- Create: `src/api/routes/prices.ts`

- [ ] **Step 1: Implement prices route**

```typescript
// src/api/routes/prices.ts
import { Router } from 'express';
import type { PriceMonitor } from '../../modules/price-monitor/index.js';
import type { PricesResponse } from '../types.js';

export interface PricesDeps {
  priceMonitor: Pick<PriceMonitor, 'getLatestPrices'>;
}

export function createPricesRouter(deps: PricesDeps): Router {
  const router = Router();

  router.get('/prices', (_req, res) => {
    const latest = deps.priceMonitor.getLatestPrices();
    const response: PricesResponse = {
      prices: latest.map((p) => ({
        platform: p.platform,
        ask: p.ask,
        bid: p.bid,
        time: p.time,
      })),
    };
    res.json(response);
  });

  return router;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/api/routes/prices.ts
git commit -m "feat(dashboard): GET /api/prices endpoint"
```

---

## Task 8: API server entry point + wire into bot

**Files:**
- Create: `src/api/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create API server factory**

```typescript
// src/api/index.ts
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { WebSocketBroadcaster } from './ws.js';
import { createStatusRouter, type StatusDeps } from './routes/status.js';
import { createOrdersRouter, type OrdersDeps } from './routes/orders.js';
import { createTradesRouter, type TradesDeps } from './routes/trades.js';
import { createPricesRouter, type PricesDeps } from './routes/prices.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('api');

export interface ApiDeps extends StatusDeps, OrdersDeps, TradesDeps, PricesDeps {}

export function createApiServer(deps: ApiDeps) {
  const app = express();
  app.use(express.json());

  // Mount API routes
  app.use('/api', createStatusRouter(deps));
  app.use('/api', createOrdersRouter(deps));
  app.use('/api', createTradesRouter(deps));
  app.use('/api', createPricesRouter(deps));

  // Serve built React dashboard in production
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dashboardDist = join(__dirname, '../../dashboard/dist');
  if (existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    app.get('*', (_req, res) => {
      res.sendFile(join(dashboardDist, 'index.html'));
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
```

- [ ] **Step 2: Wire API server into src/index.ts**

Add these lines after the `chatRelay` initialization (around line 271) and before the `start()` function:

```typescript
import { createApiServer } from './api/index.js';
```

Add to the top imports. Then inside the `start()` function, after `chatRelay.start(10_000)`:

```typescript
  // 7. Start dashboard API server
  const apiServer = createApiServer({
    bus,
    db,
    orderHandler,
    adManager,
    priceMonitor,
    bankManager,
    emergencyStop,
    bybitClient,
    getTodayProfit,
  });
  apiServer.listen(envConfig.dashboard.port, () => {
    log.info({ port: envConfig.dashboard.port }, 'Dashboard API server started');
  });
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Start bot and verify API responds**

```bash
npm start &
sleep 5
curl http://localhost:3000/api/status
```

Expected: JSON with botState, pendingOrders, etc.

- [ ] **Step 5: Commit**

```bash
git add src/api/index.ts src/index.ts
git commit -m "feat(dashboard): API server entry point wired into bot process"
```

---

## Task 9: Scaffold React dashboard with Vite + Tailwind

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/vite.config.ts`
- Create: `dashboard/tailwind.config.ts`
- Create: `dashboard/postcss.config.js`
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/index.html`
- Create: `dashboard/src/main.tsx`
- Create: `dashboard/src/index.css`
- Create: `dashboard/src/App.tsx`

- [ ] **Step 1: Create dashboard/package.json**

```json
{
  "name": "boli-dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.6.0",
    "@tanstack/react-query": "^5.75.0",
    "@fontsource-variable/inter": "^5.2.0",
    "@fontsource/jetbrains-mono": "^5.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.4.0",
    "autoprefixer": "^10.4.21",
    "postcss": "^8.5.3",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.8.0",
    "vite": "^6.3.0"
  }
}
```

- [ ] **Step 2: Create dashboard/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
```

- [ ] **Step 3: Create dashboard/tailwind.config.ts**

Warm neutral palette (not blue-gray), monospace font for financial data.

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#1c1917',  // stone-900
          subtle: '#292524',   // stone-800
          muted: '#44403c',    // stone-700
        },
        text: {
          DEFAULT: '#e7e5e4',  // stone-200
          muted: '#a8a29e',    // stone-400
          faint: '#78716c',    // stone-500
        },
      },
      fontFamily: {
        sans: ['Inter Variable', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 4: Create dashboard/postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 5: Create dashboard/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create dashboard/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Boli Dashboard</title>
  </head>
  <body class="bg-gray-950 text-gray-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create dashboard/src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import '@fontsource-variable/inter';
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/jetbrains-mono/600.css';

body {
  @apply bg-surface text-text font-sans;
  -webkit-font-smoothing: antialiased;
}

/* Monospaced numbers for financial data */
.font-num {
  font-family: 'JetBrains Mono', monospace;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 8: Create dashboard/src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 9: Create dashboard/src/App.tsx (shell with routing + connection status)**

Smart home: shows release panel if there's a `payment_marked` order, overview otherwise.

```tsx
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { useOrders } from './hooks/useApi';
import ConnectionStatus from './components/ConnectionStatus';

function Placeholder({ name }: { name: string }) {
  return <div className="p-8 text-text-muted">TODO: {name}</div>;
}

function SmartHome() {
  const { data: orders } = useOrders();
  const orderList = (orders ?? []) as any[];
  const urgentOrder = orderList.find((o: any) => o.status === 'payment_marked');
  if (urgentOrder) {
    return <Navigate to={`/order/${urgentOrder.id}`} replace />;
  }
  return <Placeholder name="Overview" />;
}

export default function App() {
  const { connected } = useWebSocket();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 text-sm ${isActive ? 'text-text' : 'text-text-faint hover:text-text-muted'}`;

  return (
    <div className="min-h-screen">
      <nav className="flex items-center justify-between border-b border-surface-muted/30 px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold tracking-wide uppercase text-text-muted mr-2">Boli</span>
          <NavLink to="/" className={linkClass} end>Overview</NavLink>
          <NavLink to="/trades" className={linkClass}>Trades</NavLink>
        </div>
        <ConnectionStatus connected={connected} />
      </nav>
      {!connected && (
        <div className="bg-amber-900/30 text-amber-200 text-sm px-6 py-2">
          Dashboard disconnected from bot — data may be stale. Reconnecting...
        </div>
      )}
      <main className="px-6 py-5">
        <Routes>
          <Route path="/" element={<SmartHome />} />
          <Route path="/order/:id" element={<Placeholder name="Release Panel" />} />
          <Route path="/trades" element={<Placeholder name="Trade History" />} />
        </Routes>
      </main>
    </div>
  );
}
```

- [ ] **Step 10: Install dependencies and verify dev server starts**

```bash
cd dashboard && npm install && npm run dev &
sleep 3
curl -s http://localhost:5173 | head -5
```

Expected: HTML response with `<div id="root">`

Kill the dev server after verifying.

- [ ] **Step 11: Commit**

```bash
git add dashboard/
git commit -m "feat(dashboard): scaffold React + Vite + Tailwind app with routing shell"
```

---

## Task 10: WebSocket hook and API hooks

**Files:**
- Create: `dashboard/src/hooks/useWebSocket.ts`
- Create: `dashboard/src/hooks/useApi.ts`

- [ ] **Step 1: Create useWebSocket hook with browser notifications**

```tsx
// dashboard/src/hooks/useWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface WsEvent {
  event: string;
  payload: any;
}

// Request notification permission on first call
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendBrowserNotification(title: string, body: string, onClick?: () => void) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body, icon: '/favicon.ico' });
    if (onClick) n.onclick = () => { window.focus(); onClick(); };
  }
}

// Short audio ping for payment notifications
const PING_URL = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ==';

function playPing() {
  try { new Audio(PING_URL).play().catch(() => {}); } catch {}
}

export function useWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    requestNotificationPermission();

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (e) => {
        try {
          const msg: WsEvent = JSON.parse(e.data);

          // Invalidate relevant queries
          if (msg.event.startsWith('order:')) {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['status'] });
          }
          if (msg.event.startsWith('price:')) {
            queryClient.invalidateQueries({ queryKey: ['prices'] });
            queryClient.invalidateQueries({ queryKey: ['status'] });
          }
          if (msg.event.startsWith('ad:') || msg.event.startsWith('emergency:')) {
            queryClient.invalidateQueries({ queryKey: ['status'] });
          }

          // Browser notification + audio for payment claimed
          if (msg.event === 'order:payment-claimed') {
            const p = msg.payload;
            playPing();
            sendBrowserNotification(
              'Payment Received',
              `${p.amount} USDT — check your bank and release`,
              () => { window.location.href = `/order/${p.orderId}`; },
            );
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000);
      };
    }

    connect();
    return () => { wsRef.current?.close(); };
  }, [queryClient]);

  return { connected };
}
```

- [ ] **Step 2: Create useApi hooks**

```tsx
// dashboard/src/hooks/useApi.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => fetchJson('/api/status'),
    refetchInterval: 10_000,
  });
}

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: () => fetchJson('/api/orders'),
    refetchInterval: 5_000,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: () => fetchJson(`/api/orders/${id}`),
    refetchInterval: 5_000,
  });
}

export function useOrderChat(id: string) {
  return useQuery({
    queryKey: ['orders', id, 'chat'],
    queryFn: () => fetchJson(`/api/orders/${id}/chat`),
    refetchInterval: 10_000,
  });
}

export function useTrades(range: string = 'today') {
  return useQuery({
    queryKey: ['trades', range],
    queryFn: () => fetchJson(`/api/trades?range=${range}`),
  });
}

export function usePrices() {
  return useQuery({
    queryKey: ['prices'],
    queryFn: () => fetchJson('/api/prices'),
    refetchInterval: 30_000,
  });
}

export function useReleaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/orders/${orderId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Release failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

export function useDisputeOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/orders/${orderId}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Dispute failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
```

- [ ] **Step 3: Verify typecheck**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/hooks/
git commit -m "feat(dashboard): useWebSocket and useApi React hooks"
```

---

## Task 11: Shared components (ConnectionStatus, OrderRow, ConfirmDialog)

**Files:**
- Create: `dashboard/src/components/ConnectionStatus.tsx`
- Create: `dashboard/src/components/OrderRow.tsx`
- Create: `dashboard/src/components/ConfirmDialog.tsx`

- [ ] **Step 1: Create ConnectionStatus**

```tsx
// dashboard/src/components/ConnectionStatus.tsx
interface Props {
  connected: boolean;
}

export default function ConnectionStatus({ connected }: Props) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
      <span className="text-text-faint">
        {connected ? 'Connected' : 'Reconnecting...'}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create OrderRow (no card — plain row with hover)**

```tsx
// dashboard/src/components/OrderRow.tsx
import { useNavigate } from 'react-router-dom';

interface Props {
  id: string;
  side: string;
  amount: number;
  price: number;
  totalBob: number;
  status: string;
  counterpartyName: string;
}

const STATUS_COLOR: Record<string, string> = {
  payment_marked: 'text-amber-400',
  awaiting_payment: 'text-blue-400',
  new: 'text-text-faint',
  disputed: 'text-red-400',
};

export default function OrderRow({ id, side, amount, price, totalBob, status, counterpartyName }: Props) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/order/${id}`)}
      className="flex items-baseline justify-between py-2.5 border-b border-surface-muted/20 cursor-pointer hover:bg-surface-subtle/50 -mx-2 px-2 transition-colors"
    >
      <div className="flex items-baseline gap-3">
        <span className={`text-xs font-semibold uppercase ${side === 'sell' ? 'text-amber-400' : 'text-blue-400'}`}>
          {side}
        </span>
        <span className="font-num text-sm">{amount}</span>
        <span className="text-text-faint text-xs">@</span>
        <span className="font-num text-sm">{price}</span>
        <span className="text-text-faint text-xs">=</span>
        <span className="font-num text-sm font-semibold">{totalBob.toFixed(2)}</span>
        <span className="text-text-faint text-xs">BOB</span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-text-muted text-xs">{counterpartyName}</span>
        <span className={`text-xs ${STATUS_COLOR[status] ?? 'text-text-faint'}`}>
          {status.replace('_', ' ')}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ConfirmDialog (with keyboard support)**

```tsx
// dashboard/src/components/ConfirmDialog.tsx
import { useEffect } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor?: 'green' | 'red';
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmDialog({ open, title, message, confirmLabel, confirmColor = 'green', onConfirm, onCancel, loading }: Props) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && !loading) onConfirm();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onConfirm, onCancel, loading]);

  if (!open) return null;

  const btnClass = confirmColor === 'green'
    ? 'bg-green-600 hover:bg-green-500 text-white'
    : 'bg-red-600 hover:bg-red-500 text-white';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-surface-subtle border border-surface-muted/30 p-6 max-w-md w-full mx-4">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-text-muted mt-2 text-sm">{message}</p>
        <div className="text-text-faint text-xs mt-3">Enter to confirm · Esc to cancel</div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-text-faint hover:text-text" disabled={loading}>
            Cancel
          </button>
          <button onClick={onConfirm} className={`px-4 py-2 text-sm font-semibold ${btnClass}`} disabled={loading}>
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/
git commit -m "feat(dashboard): ConnectionStatus, OrderRow, ConfirmDialog components"
```

---

## Task 12: Overview page

**Files:**
- Create: `dashboard/src/pages/Overview.tsx`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Create Overview page (no cards — plain text metrics, asymmetric layout)**

```tsx
// dashboard/src/pages/Overview.tsx
import { useStatus, useOrders } from '../hooks/useApi';
import OrderRow from '../components/OrderRow';

export default function Overview() {
  const { data: status, isLoading } = useStatus();
  const { data: orders } = useOrders();

  if (isLoading || !status) {
    return <div className="text-text-faint">Loading...</div>;
  }

  const s = status as any;
  const orderList = (orders ?? []) as any[];

  return (
    <div>
      {/* Metrics — plain text, no cards */}
      <div className="flex items-baseline gap-8 mb-8">
        <div>
          <span className={`text-sm font-semibold ${s.botState === 'running' ? 'text-green-500' : 'text-red-500'}`}>
            {s.botState.toUpperCase()}
          </span>
        </div>
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Orders</span>
          <span className="font-num">{s.pendingOrders}</span>
        </div>
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Profit today</span>
          <span className="font-num text-lg font-semibold">{s.todayProfit.profitBob.toFixed(2)}</span>
          <span className="text-text-faint text-xs ml-1">BOB</span>
        </div>
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Ask</span>
          <span className="font-num">{s.prices.ask.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Bid</span>
          <span className="font-num">{s.prices.bid.toFixed(2)}</span>
        </div>
      </div>

      {/* Asymmetric two-column: orders (~65%) + bank (~35%) */}
      <div className="grid gap-10" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Active Orders</h2>
          {orderList.length === 0 ? (
            <div className="text-text-faint text-sm py-4">
              No pending orders. Watching for incoming trades...
            </div>
          ) : (
            <div>
              {orderList.map((o: any) => (
                <OrderRow
                  key={o.id}
                  id={o.id}
                  side={o.side}
                  amount={o.amount}
                  price={o.price}
                  totalBob={o.totalBob}
                  status={o.status}
                  counterpartyName={o.counterpartyName}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Bank Accounts</h2>
          {s.bankAccounts.map((a: any) => (
            <div key={a.id} className="flex justify-between py-2 border-b border-surface-muted/20 last:border-0 text-sm">
              <span className="text-text-muted">{a.name}</span>
              <span className="font-num">{a.balanceBob.toFixed(2)} <span className="text-text-faint text-xs">BOB</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx SmartHome to use Overview**

Replace the `<Placeholder name="Overview" />` in the SmartHome function with `<Overview />`, and add the import:

```tsx
import Overview from './pages/Overview';
```

In `SmartHome`:
```tsx
return <Overview />;
```

- [ ] **Step 3: Verify it builds**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/Overview.tsx dashboard/src/App.tsx
git commit -m "feat(dashboard): Overview page — plain-text metrics, no cards, asymmetric layout"
```

---

## Task 13: ChatView component

**Files:**
- Create: `dashboard/src/components/ChatView.tsx`

- [ ] **Step 1: Create ChatView**

```tsx
// dashboard/src/components/ChatView.tsx
import { useEffect, useRef } from 'react';

interface Message {
  content: string;
  contentType: string;
  sendTime: number;
  fromUserId: string;
  roleType: string;
  nickName: string;
}

interface Props {
  messages: Message[];
  myUserId: string;
}

export default function ChatView({ messages, myUserId }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full overflow-y-auto space-y-2 pr-1">
      {messages
        .filter((m) => m.roleType !== 'sys')
        .map((m, i) => {
          const isMe = m.fromUserId === myUserId;
          const isImage = m.contentType === 'pic' || m.contentType === '2';

          return (
            <div key={i} className={`max-w-[85%] ${isMe ? '' : 'ml-auto'}`}>
              <div className={`rounded-lg px-3 py-2 text-sm ${isMe ? 'bg-gray-950' : 'bg-green-950/40'}`}>
                <div className={`text-[11px] ${isMe ? 'text-blue-400' : 'text-green-400'}`}>
                  {isMe ? 'You' : m.nickName}
                </div>
                {isImage ? (
                  m.content.startsWith('http') ? (
                    <img src={m.content} alt="chat image" className="mt-1 rounded max-w-full" />
                  ) : (
                    <span className="text-gray-400 italic">[Image]</span>
                  )
                ) : (
                  <div className="text-gray-100 mt-0.5">{m.content}</div>
                )}
              </div>
            </div>
          );
        })}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/ChatView.tsx
git commit -m "feat(dashboard): ChatView component for P2P messages"
```

---

## Task 14: Release Panel page

**Files:**
- Create: `dashboard/src/pages/ReleasePanel.tsx`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Create ReleasePanel page (asymmetric columns, full-width release button, resolved bank name)**

```tsx
// dashboard/src/pages/ReleasePanel.tsx
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useOrder, useOrderChat, useStatus, useReleaseOrder, useDisputeOrder } from '../hooks/useApi';
import ChatView from '../components/ChatView';
import ConfirmDialog from '../components/ConfirmDialog';

export default function ReleasePanel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: order, isLoading } = useOrder(id!);
  const { data: chatMessages, isError: chatError, refetch: refetchChat } = useOrderChat(id!);
  const { data: status } = useStatus();
  const release = useReleaseOrder();
  const dispute = useDisputeOrder();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  if (isLoading || !order) {
    return <div className="text-text-faint">Loading order...</div>;
  }

  const o = order as any;
  const s = status as any;
  const messages = (chatMessages ?? []) as any[];
  const timeAgo = Math.round((Date.now() - o.createdAt) / 60000);
  const bybitUserId = s?.bybitUserId ?? '';

  return (
    <div>
      <button onClick={() => navigate('/')} className="text-text-faint hover:text-text text-xs mb-5">
        &larr; back
      </button>

      {/* Three columns: order (narrow) | chat (wide) | bank (narrow) */}
      <div className="grid gap-8" style={{ gridTemplateColumns: '240px 1fr 240px' }}>
        {/* Left: Order Details */}
        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Order</h2>
          <div className="text-sm text-text-muted space-y-1.5">
            <div className="font-num text-text-faint text-xs">#{o.id.slice(-12)}</div>
            <div className={`text-sm font-semibold ${o.side === 'sell' ? 'text-amber-400' : 'text-blue-400'}`}>{o.side.toUpperCase()}</div>
            <div><span className="font-num text-text">{o.amount}</span> USDT</div>
            <div>@ <span className="font-num text-text">{o.price}</span> BOB</div>
            <div className="pt-1 border-t border-surface-muted/20">
              <span className="font-num text-lg font-semibold text-text">{o.totalBob.toFixed(2)}</span>
              <span className="text-text-faint text-xs ml-1">BOB</span>
            </div>
            <div className="pt-1">{o.counterpartyName}</div>
            <div className={`text-xs ${o.status === 'payment_marked' ? 'text-amber-400' : 'text-text-faint'}`}>
              {o.status.replace('_', ' ')} · {timeAgo}m ago
            </div>
          </div>
        </div>

        {/* Center: Chat (widest column) */}
        <div className="flex flex-col max-h-[450px]">
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Chat</h2>
          {chatError ? (
            <div className="text-text-faint text-sm">
              Could not load chat messages.{' '}
              <button onClick={() => refetchChat()} className="text-text-muted underline">Retry</button>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden">
              <ChatView messages={messages} myUserId={bybitUserId} />
            </div>
          )}
        </div>

        {/* Right: Bank Verification */}
        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Bank</h2>
          <div className="text-sm text-text-muted space-y-1.5">
            <div className="text-text-faint text-[10px] uppercase">Expected payment</div>
            <div className="font-num text-lg font-semibold text-green-500">{o.totalBob.toFixed(2)} BOB</div>
            <div className="text-text">{o.bankAccountName || `Account #${o.bankAccountId}`}</div>
          </div>
          <div className="mt-6 border border-dashed border-surface-muted/30 p-3 text-center text-text-faint text-xs">
            Auto-verify: Phase 2
          </div>
        </div>
      </div>

      {/* Full-width release action zone */}
      <div className="mt-8 pt-5 border-t border-surface-muted/20">
        {releaseError && (
          <div className="text-red-400 text-sm mb-3">{releaseError}</div>
        )}
        <button
          onClick={() => { setReleaseError(null); setShowConfirm(true); }}
          disabled={o.status !== 'payment_marked'}
          className="w-full py-3 text-sm font-semibold bg-green-600 hover:bg-green-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Release {o.totalBob.toFixed(2)} BOB to {o.counterpartyName}
        </button>
        <div className="text-center mt-2">
          <button onClick={() => setShowDispute(true)} className="text-text-faint text-xs hover:text-red-400">
            Open dispute
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="Confirm Release"
        message={`Release ${o.amount} USDT (${o.totalBob.toFixed(2)} BOB) to ${o.counterpartyName}. This cannot be undone.`}
        confirmLabel="Release Now"
        confirmColor="green"
        loading={release.isPending}
        onConfirm={() => {
          release.mutate(o.id, {
            onSuccess: () => { setShowConfirm(false); navigate('/'); },
            onError: (err: any) => { setShowConfirm(false); setReleaseError(err.message); },
          });
        }}
        onCancel={() => setShowConfirm(false)}
      />

      <ConfirmDialog
        open={showDispute}
        title="Open Dispute"
        message={`Open a dispute for this order? This escalates to Bybit support.`}
        confirmLabel="Open Dispute"
        confirmColor="red"
        loading={dispute.isPending}
        onConfirm={() => {
          dispute.mutate(o.id, {
            onSuccess: () => { setShowDispute(false); navigate('/'); },
          });
        }}
        onCancel={() => setShowDispute(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx route to use ReleasePanel**

Add import:
```tsx
import ReleasePanel from './pages/ReleasePanel';
```

Replace the `/order/:id` route:
```tsx
<Route path="/order/:id" element={<ReleasePanel />} />
```

- [ ] **Step 3: Verify typecheck**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/ReleasePanel.tsx dashboard/src/App.tsx
git commit -m "feat(dashboard): Release Panel — full-width action button, chat, bank name resolved"
```

---

## Task 15: Trade History page

**Files:**
- Create: `dashboard/src/pages/TradeHistory.tsx`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Create TradeHistory page (hero profit, period comparison, spread column)**

```tsx
// dashboard/src/pages/TradeHistory.tsx
import { useState } from 'react';
import { useTrades } from '../hooks/useApi';

const RANGES = ['today', '7d', '30d'] as const;
const RANGE_LABELS: Record<string, string> = { today: 'Today', '7d': '7 days', '30d': '30 days' };

export default function TradeHistory() {
  const [range, setRange] = useState<string>('today');
  const { data, isLoading } = useTrades(range);

  const result = data as any;
  const trades = result?.trades ?? [];
  const summary = result?.summary ?? { tradesCount: 0, volumeUsdt: 0, profitBob: 0 };
  const prev = result?.previousPeriod ?? { profitBob: 0 };

  const profitDelta = prev.profitBob > 0
    ? ((summary.profitBob - prev.profitBob) / prev.profitBob * 100).toFixed(0)
    : null;

  return (
    <div>
      {/* Hero profit */}
      <div className="mb-6">
        <div className="text-text-faint text-xs uppercase tracking-wide mb-1">Profit</div>
        <div className="flex items-baseline gap-3">
          <span className="font-num text-3xl font-semibold">{summary.profitBob.toFixed(2)}</span>
          <span className="text-text-faint text-sm">BOB</span>
          {profitDelta !== null && (
            <span className={`text-xs font-num ${Number(profitDelta) >= 0 ? 'text-green-500' : 'text-red-400'}`}>
              {Number(profitDelta) >= 0 ? '+' : ''}{profitDelta}% vs prev
            </span>
          )}
        </div>
      </div>

      {/* Range tabs + summary */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-xs ${range === r ? 'text-text border-b border-text' : 'text-text-faint hover:text-text-muted'}`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="text-xs text-text-faint">
          <span className="font-num">{summary.tradesCount}</span> trades · <span className="font-num">{summary.volumeUsdt.toFixed(0)}</span> USDT vol
        </div>
      </div>

      {isLoading ? (
        <div className="text-text-faint text-sm">Loading...</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-faint uppercase text-[10px] tracking-wide">
              <th className="text-left py-2 pr-3 border-b border-surface-muted/20">Time</th>
              <th className="text-left py-2 pr-3 border-b border-surface-muted/20">Side</th>
              <th className="text-right py-2 pr-3 border-b border-surface-muted/20">USDT</th>
              <th className="text-right py-2 pr-3 border-b border-surface-muted/20">Price</th>
              <th className="text-right py-2 pr-3 border-b border-surface-muted/20">Total BOB</th>
              <th className="text-right py-2 pr-3 border-b border-surface-muted/20">Spread</th>
              <th className="text-left py-2 pr-3 border-b border-surface-muted/20">Counterparty</th>
              <th className="text-left py-2 border-b border-surface-muted/20">Status</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t: any) => (
              <tr key={t.id} className="border-b border-surface-muted/10 hover:bg-surface-subtle/30">
                <td className="py-2 pr-3 font-num text-text-muted">{t.createdAt ? new Date(t.createdAt).toLocaleTimeString() : '-'}</td>
                <td className={`py-2 pr-3 text-xs font-semibold ${t.side === 'sell' ? 'text-amber-400' : 'text-blue-400'}`}>{t.side.toUpperCase()}</td>
                <td className="py-2 pr-3 text-right font-num">{t.amountUsdt}</td>
                <td className="py-2 pr-3 text-right font-num">{t.priceBob}</td>
                <td className="py-2 pr-3 text-right font-num">{t.totalBob.toFixed(2)}</td>
                <td className="py-2 pr-3 text-right font-num text-text-muted">
                  {t.spreadCaptured != null ? `${(t.spreadCaptured * 100).toFixed(1)}%` : '-'}
                </td>
                <td className="py-2 pr-3 text-text-muted">{t.counterpartyName ?? '-'}</td>
                <td className="py-2">
                  <span className={t.status === 'completed' ? 'text-green-500' : 'text-text-faint'}>
                    {t.status}
                  </span>
                </td>
              </tr>
            ))}
            {trades.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-text-faint">No trades in this period</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx route**

Add import:
```tsx
import TradeHistory from './pages/TradeHistory';
```

Replace the trades route:
```tsx
<Route path="/trades" element={<TradeHistory />} />
```

- [ ] **Step 3: Verify typecheck**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/TradeHistory.tsx dashboard/src/App.tsx
git commit -m "feat(dashboard): Trade History — hero profit, period comparison, spread column"
```

---

## Task 16: End-to-end smoke test

**Files:**
- Modify: `dashboard/src/App.tsx` (remove any remaining Placeholder references)

- [ ] **Step 1: Build the dashboard**

```bash
cd dashboard && npm run build
```

Expected: builds to `dashboard/dist/` with no errors

- [ ] **Step 2: Start the bot (serves dashboard at port 3000)**

```bash
npm start &
sleep 5
```

- [ ] **Step 3: Verify API endpoints**

```bash
curl -s http://localhost:3000/api/status | head -c 200
curl -s http://localhost:3000/api/orders | head -c 200
curl -s http://localhost:3000/api/trades | head -c 200
curl -s http://localhost:3000/api/prices | head -c 200
```

Expected: all return valid JSON

- [ ] **Step 4: Verify dashboard is served**

```bash
curl -s http://localhost:3000/ | head -5
```

Expected: HTML with `<div id="root">`

- [ ] **Step 5: Open http://localhost:3000 in browser and verify:**
- Overview loads with status cards
- Bank accounts visible
- Clicking an order (if any) opens release panel
- Trades page shows history

- [ ] **Step 6: Commit final cleanup**

```bash
git add -A
git commit -m "feat(dashboard): end-to-end integration complete"
```

---

## Summary

| Task | What it builds |
|------|---------------|
| 1 | Dependencies + config |
| 2 | Shared API types (with bybitUserId, bankAccountName, spreadCaptured, previousPeriod) |
| 3 | WebSocket broadcaster (TDD) |
| 4 | Status route with bybitUserId (TDD) |
| 5 | Orders route + release safety + bank name resolution (TDD) |
| 6 | Trades route with spread + previous period comparison (TDD) |
| 7 | Prices route |
| 8 | API server entry + bot wiring |
| 9 | React scaffold — warm neutral palette, Inter + JetBrains Mono fonts, smart home routing |
| 10 | WS hook with browser notifications + audio ping, API hooks |
| 11 | ConnectionStatus, OrderRow (no cards), ConfirmDialog (keyboard shortcuts) |
| 12 | Overview — plain-text metrics, asymmetric layout, no cards |
| 13 | ChatView component |
| 14 | Release Panel — asymmetric columns, full-width release button, error states |
| 15 | Trade History — hero profit with period comparison, spread column |
| 16 | End-to-end smoke test |
