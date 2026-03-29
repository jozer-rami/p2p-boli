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
| GET | `/api/status` | Bot state, pending count, active ads, current prices, bank balances, bybitUserId |
| GET | `/api/orders` | All pending orders with details |
| GET | `/api/orders/:id` | Single order detail (includes resolved bank account name) |
| GET | `/api/orders/:id/chat` | Chat messages for an order |
| GET | `/api/trades?range=today\|7d\|30d` | Trade history with P&L summary + previous period comparison |
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

## Design Direction

**Aesthetic: Utilitarian operator terminal.** No cards, no rounded rectangles, no colored borders. Data separated by whitespace and typography. Dense, text-heavy, monospaced numbers. Warm neutral palette (not blue-gray). Think Bloomberg terminal meets a well-designed CLI — not a SaaS dashboard.

**Principles:**
- No cards. Data lives directly on the background, grouped by space and type scale.
- Monospaced font for all financial numbers (amounts, prices, totals). Proportional font for labels and text.
- Asymmetric layout — not everything in equal-width columns.
- Color used only to communicate: green = money received/success, yellow/amber = needs attention, red = danger/error. Never decorative.
- High information density — this is a tool for someone who stares at it for hours.

## Screens

### Smart Home: Overview or Release Panel

The home route (`/`) is context-aware:
- **If a pending order exists with status `payment_marked`:** show the Release Panel directly. This is the highest-priority action.
- **Otherwise:** show the Overview.

This eliminates a navigation step for the most critical workflow.

### Overview

Top section — key metrics displayed as plain text, not cards:
- Bot status (RUNNING / EMERGENCY) as a colored word
- Pending orders count
- Today's profit in BOB (large, prominent)
- Current USDT/BOB ask price

Below — two asymmetric regions:
- **Active orders** (wider, ~65%) — list of pending orders. Each row shows side, truncated ID, amount, price, counterparty, status. Clickable to open release panel.
- **Bank accounts** (narrower, ~35%) — account names with balances. Simple list, no decoration.

Data sources: `GET /api/status` on load, WebSocket events for real-time updates.

### Release Panel

The critical decision screen. Three columns, asymmetric widths (order details narrower, chat wider, bank verification narrower).

**Left — Order Details:**
Order ID (truncated), side, USDT amount, price, total BOB, counterparty name, status, time since creation. Plain text list, no card wrapper.

**Center — P2P Chat:**
Scrollable chat showing messages between user and counterparty. User messages left-aligned, counterparty right-aligned. Text and image support. This column gets the most width since chat context is critical for the release decision.

**Right — Bank Verification:**
Expected payment amount and target bank account *name* (resolved from ID, not just the numeric ID). Placeholder note for Phase 2 auto-verify.

**Bottom — Action Zone (full-width):**
The release button is **full-width, large, and displays the amount**: "Release 1,401.90 BOB to cripto.luis.bo". It's the unmistakable primary action. Dispute is a small text link below it, not a competing button. Release opens a confirmation dialog. Keyboard shortcut: `Enter` to confirm, `Escape` to cancel.

Data sources: `GET /api/orders/:id` + `GET /api/orders/:id/chat`. WebSocket for live status updates.

### Trade History

**Hero metric:** Today's profit displayed large and prominent, with a comparison to the previous period ("↑ 12% vs yesterday"). This is the first thing the eye hits.

Below the hero: time range filter tabs (Today, 7 days, 30 days) with summary stats (trade count, USDT volume).

Table columns: Time, Side, USDT amount, Price, Total BOB, Spread Captured, Counterparty, Status. The spread column is the actual business metric.

Data source: `GET /api/trades?range=today|7d|30d`.

## Browser Notifications

This directly solves the "missed notifications" problem. When `order:payment-claimed` arrives via WebSocket:
1. Play a short audio ping
2. Show a browser Notification: "Payment received — 1,401.90 BOB from cripto.luis.bo"
3. Clicking the notification focuses the dashboard tab and navigates to the release panel

The dashboard requests notification permission on first load.

## Connection Status

The nav bar includes a connection status indicator:
- Green dot + "Connected" when WebSocket is open
- Red dot + "Reconnecting..." when WebSocket is closed/reconnecting
- This prevents the user from seeing stale data and thinking the bot is running when it's not

## Error & Empty States

- **No pending orders:** Show last completed trade details and current price. "Waiting for orders" with the current spread.
- **Bot disconnected:** Full-width amber banner: "Dashboard disconnected from bot — data may be stale. Reconnecting..."
- **Release failed:** Error shown inline below the release button with the exact error message and a retry option.
- **Chat load failed:** "Could not load chat messages" with retry button. Don't block the release action.

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| API framework | Express | Already familiar, lightweight router |
| WebSocket | `ws` | No socket.io overhead, simple event forwarding |
| Frontend framework | React | User preference, good ecosystem for dashboards |
| Build tool | Vite | Fast HMR in dev, clean production builds |
| Styling | Tailwind CSS | Rapid development, custom dark palette (warm neutrals, not blue-gray) |
| Data fetching | React Query (TanStack Query) | Caching, background refetch, stale management |
| Real-time | Custom `useWebSocket` hook | Subscribes to WS, updates React Query cache, auto-reconnects, triggers browser notifications |

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
│   │       ├── ConnectionStatus.tsx
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
  bus, db, orderHandler, adManager, priceMonitor,
  bankManager, emergencyStop, bybitClient, getTodayProfit,
});

apiServer.listen(envConfig.dashboard.port ?? 3000);
```

The API port defaults to 3000, configurable via `DASHBOARD_PORT` env var.

The API server receives references to existing module instances — no new dependencies, no changes to module internals. It reads state through the same public methods that Telegram commands use.

## What This Does NOT Include

- Authentication/login (localhost only, single user)
- Mobile responsive design (desktop only, TG handles mobile)
- Ad management from dashboard (keep using TG or Bybit directly)
- Bank balance auto-verification (Phase 2 — noted as placeholder in release panel)
- Historical price charts or analytics beyond the trade table
