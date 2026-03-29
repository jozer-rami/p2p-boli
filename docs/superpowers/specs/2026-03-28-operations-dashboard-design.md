# Operations Dashboard Design Spec

## Problem

Telegram is the sole interface for the P2P trading bot. This causes two problems:
1. **Missed notifications** — TG messages get buried, no persistent visibility into bot state
2. **Risky actions** — one-tap release button with no confirmation step or context to verify against

## Solution

A desktop web dashboard that complements Telegram. TG remains the mobile alert channel; the dashboard becomes the command center for monitoring and executing critical actions like fund release.

## Architecture

Hybrid approach: embedded API server in the bot process + separate React frontend.

```
Bot Process (src/index.ts)
├── Existing modules (OrderHandler, AdManager, PriceMonitor, etc.)
├── EventBus
└── API Layer (new)
    ├── REST endpoints (Express router)
    ├── WebSocket (ws library) — fans out EventBus events to dashboard clients
    └── Static file server (serves built React app in production)

React App (dashboard/)
├── Dev: Vite dev server, proxies /api and /ws to bot process
└── Prod: Built to dashboard/dist/, served by bot as static files
```

The API layer lives inside the bot process for direct access to in-memory state (tracked orders, prices, ads) and the EventBus. WebSocket provides real-time updates without polling.

## API Contract

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Bot state, pending count, active ads, current prices, bank balances |
| GET | `/api/orders` | All pending orders with details |
| GET | `/api/orders/:id` | Single order detail |
| GET | `/api/orders/:id/chat` | Chat messages for an order |
| GET | `/api/trades?range=today\|7d\|30d` | Trade history with P&L summary |
| GET | `/api/prices` | Current USDT/BOB prices from all sources |
| POST | `/api/orders/:id/release` | Release order (body: `{ confirm: true }`) |
| POST | `/api/orders/:id/dispute` | Open dispute |

### Release Safety

The release endpoint requires `{ confirm: true }` in the request body. The frontend enforces a two-step flow: show confirmation dialog with order details, then send the request. This prevents accidental releases.

### WebSocket Events

Single WS connection at `/ws`. Server pushes events as JSON:

```json
{ "event": "order:payment-claimed", "payload": { "orderId": "...", "amount": 150, "bankAccount": "..." } }
```

Forwarded events:
- `order:new`, `order:payment-claimed`, `order:released`, `order:cancelled`
- `price:updated`
- `ad:created`, `ad:repriced`
- `emergency:triggered`, `emergency:resolved`

No new event types — the API layer subscribes to existing EventBus events and forwards them.

## Screens

### 1. Overview (Home)

Top row of status cards:
- Bot status (running/emergency) with color indicator
- Pending order count
- Today's profit (BOB)
- Current USDT/BOB ask price

Below the cards:
- **Active orders panel** (left, wider) — list of pending orders with side, amount, price, counterparty, status badge. Clicking an order navigates to the release panel.
- **Bank accounts panel** (right, narrower) — account names with current BOB balances

Data sources: `GET /api/status` on load, WebSocket events for real-time updates.

### 2. Release Panel

Three-column layout for the order decision view:

**Left column — Order Details:**
Order ID, side, USDT amount, price, total BOB, counterparty name, status, creation time.

**Center column — P2P Chat:**
Scrollable chat view showing messages between you and the counterparty. Your messages on the left (blue), theirs on the right (green). Supports text and image messages (images shown inline if URL, placeholder text if not).

**Right column — Bank Verification:**
Shows expected payment amount and target bank account. For now this is a manual check prompt. Placeholder for Phase 2 auto-verify via mobile automation.

**Bottom — Action Buttons:**
"Dispute" (red) and "Confirm & Release" (green). Release opens a confirmation dialog showing order summary before executing.

Data sources: `GET /api/orders/:id` + `GET /api/orders/:id/chat`. WebSocket for status updates while viewing.

### 3. Trade History

Time range filter tabs: Today, 7 days, 30 days.

Summary bar: trade count, total USDT volume, total BOB profit for selected range.

Table columns: Time, Side, USDT amount, Price, Total BOB, Counterparty, Status.

Data source: `GET /api/trades?range=today|7d|30d`.

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| API framework | Express | Already familiar, lightweight router |
| WebSocket | `ws` | No socket.io overhead, simple event forwarding |
| Frontend framework | React | User preference, good ecosystem for dashboards |
| Build tool | Vite | Fast HMR in dev, clean production builds |
| Styling | Tailwind CSS | Rapid dark-theme UI development |
| Data fetching | React Query (TanStack Query) | Caching, background refetch, stale management |
| Real-time | Custom `useWebSocket` hook | Subscribes to WS, updates React Query cache, auto-reconnects on disconnect |

## Project Structure

```
boli/
├── src/
│   ├── api/                    # New API layer
│   │   ├── index.ts            # Express app + WS setup, mounted in bot
│   │   ├── routes/
│   │   │   ├── status.ts       # GET /api/status
│   │   │   ├── orders.ts       # GET/POST /api/orders/*
│   │   │   ├── trades.ts       # GET /api/trades
│   │   │   └── prices.ts       # GET /api/prices
│   │   └── ws.ts               # WebSocket event forwarding
│   └── ... (existing modules)
├── dashboard/                  # React frontend (separate package.json)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts
│   │   │   └── useApi.ts
│   │   ├── pages/
│   │   │   ├── Overview.tsx
│   │   │   ├── ReleasePanel.tsx
│   │   │   └── TradeHistory.tsx
│   │   └── components/
│   │       ├── StatusCard.tsx
│   │       ├── OrderRow.tsx
│   │       ├── ChatView.tsx
│   │       └── ConfirmDialog.tsx
│   └── dist/                   # Built output (served by bot in prod)
└── ...
```

## Integration with Bot Process

In `src/index.ts`, after existing module setup:

```typescript
import { createApiServer } from './api/index.js';

const apiServer = createApiServer({
  bus,
  db,
  orderHandler,
  adManager,
  priceMonitor,
  bankManager,
  emergencyStop,
});

apiServer.listen(envConfig.dashboard?.port ?? 3000);
```

The API port defaults to 3000, configurable via `DASHBOARD_PORT` env var.

The API server receives references to existing module instances — no new dependencies, no changes to module internals. It reads state through the same public methods that Telegram commands use (e.g., `orderHandler.getTrackedOrders()`, `priceMonitor.getLatestPrices()`).

## What This Does NOT Include

- Authentication/login (localhost only, single user)
- Mobile responsive design (desktop only, TG handles mobile)
- Ad management from dashboard (keep using TG or Bybit directly)
- Bank balance auto-verification (Phase 2 — noted as placeholder in release panel)
- Historical price charts or analytics beyond the trade table
