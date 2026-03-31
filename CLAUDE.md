# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Dev mode with auto-reload (bot + dashboard on :3000)
npm start                # Production run
npm run start:dry        # Dry run mode (no real trades)
npm run build            # Compile TypeScript to dist/
npm test                 # Run tests once (vitest run)
npm run test:integration # Run integration tests (real DB, mocked APIs)
npm run test:watch       # Run tests in watch mode
npm run typecheck        # Type-check only (tsc --noEmit)
npm run seed:banks       # Seed bank accounts from script
npm run simulate         # Price replay & stress test simulator
```

Dashboard dev (if running separately):
```bash
cd dashboard && npm run dev   # Vite dev server with HMR
cd dashboard && npx vite build # Production build → dashboard/dist/
```

## Architecture

Automated P2P USDT/BOB trading bot on Bybit with Telegram control interface. ESM-only TypeScript project (`"type": "module"`).

### Core Pattern: Event Bus + Polling Loops

All modules communicate through an in-memory **EventBus** (`src/event-bus.ts`) with typed events. Modules never import each other directly. Every event emission is persisted to the `event_log` table for tracing.

**Entry point** (`src/index.ts`) wires all modules, injects dependencies, and starts polling loops:

| Module | Interval | Role |
|--------|----------|------|
| OrderHandler | 5s | Poll Bybit for pending P2P orders, detect status changes |
| AdManager | 30s | Create/reprice/cancel P2P ads based on market spread |
| PriceMonitor | 60s | Fetch USDT/BOB prices from CriptoYa (Bybit + Binance P2P) |
| ChatRelay | 10s | Relay Bybit P2P chat messages to/from Telegram |

**Other modules** (not polling-based):
- **TelegramBot** — Grammy-based command interface + alert notifications with inline keyboards
- **BankManager** — Bank account selection, balance tracking, QR code paths
- **EmergencyStop** — Auto-halt on volatility, stale data, gap jumps, thin books, or session drift
- **RepricingEngine** — Phase-based order book analysis for optimal ad positioning

### API Server + Dashboard

Express server (`src/api/`) serves both JSON API and the built React dashboard from `dashboard/dist/`. WebSocket on `/ws` broadcasts real-time events.

**Route files** in `src/api/routes/`:
- `status.ts` — Bot state, pending orders, prices, profit
- `orders.ts` — Order CRUD, chat messages, release/dispute
- `banks.ts` — Bank account CRUD, QR upload/preview/delete
- `trades.ts` — Trade history
- `prices.ts` — Current market prices
- `config.ts` — Guard config read/write (GET/PATCH `/api/config/guards`)
- `repricing.ts` — Repricing engine status

**To add a new route**: create file in `src/api/routes/`, export a `create*Router(deps)` function with a typed deps interface, mount in `src/api/index.ts`.

### Dashboard (React)

`dashboard/` — React 19 + Vite + Tailwind CSS + React Query.

- **Pages**: `Overview`, `ReleasePanel`, `TradeHistory` in `dashboard/src/pages/`
- **Components**: `BankQrManager`, `ChatSidebar`, `ChatView`, `OrderRow`, `GuardConfig`, `RepricingConfig`, `RepricingStatus`, etc. in `dashboard/src/components/`
- **Hooks**: `useApi.ts` (React Query hooks for all endpoints), `useWebSocket.ts` (real-time events), `useChatSidebar.tsx` (sidebar state)
- **Tailwind config**: Custom dark theme with `surface`, `text` color scales in `dashboard/tailwind.config.ts`

To add a new API hook: add to `dashboard/src/hooks/useApi.ts` — use `useQuery` for GET, `useMutation` for POST/PUT/PATCH/DELETE, invalidate relevant query keys on success.

### Order Lifecycle State Machine

Defined in `src/modules/order-handler/lifecycle.ts`:
```
new → awaiting_payment → payment_marked → released | cancelled | disputed
```
Release is triggered manually via Telegram (`/release <orderId>` or inline "Confirm & Release" button).

### Database

SQLite via **Drizzle ORM** with WAL mode. Schema in `src/db/schema.ts`. Tables: `config`, `bank_accounts`, `trades`, `ads`, `daily_pnl`, `event_log`.

Config values (spread, polling intervals, etc.) are stored in the `config` table and seeded on startup from `DEFAULT_CONFIG` in `src/config.ts`. Config is read at startup and stored in local variables — changing a config value requires a restart (except `active_sides`, `reprice_enabled`, and guard configs which can be updated at runtime via `PATCH /api/config/guards`).

### QR Code Auto-Send

On new sell orders, the bot sends three messages to the Bybit P2P chat:
1. Pre-QR greeting (`qr_pre_message` config key)
2. QR code image (from `bank_accounts.qr_code_path`)
3. Payment instructions (`bank_accounts.payment_message` or generated fallback)

QR images are stored in `data/qr/` and managed via the dashboard or `PUT /api/banks/:id/qr`.

### Telegram Commands

Registered in `src/modules/telegram/commands.ts`, wired in `src/modules/telegram/index.ts`. To add a command: add handler function in `commands.ts`, add dep to `CommandDeps` interface if needed, register with `this.bot.command()`, wire the dep in `src/index.ts`.

### Pricing & Spread Model

**P2P markets can invert** (bid > ask). Unlike spot exchanges, P2P orders don't auto-match, so inversions are temporary arbitrage opportunities, not errors. All spread calculations use `Math.abs(ask - bid)` to treat inversions as profit opportunities.

**Spread calculation**: `effectiveSpread = Math.abs(bestAsk - bestBid)`. If `effectiveSpread < minSpread` → pause ads. If `effectiveSpread >= minSpread` → trade, using the full available spread (clamped to `maxSpread`).

**Two pricing paths**:
1. **RepricingEngine** (primary) — 11-phase pipeline analyzing the order book, positioning at target rank, filtering aggressive competitors
2. **calculatePricing()** (fallback) — simpler mid-price + symmetric spread approach, used when repricing engine fails

### Safety Guards

Three config-gated guards in PriceMonitor, all disabled by default. Toggle via dashboard (Overview → Safety Guards panel) or `PATCH /api/config/guards`.

| Guard | Config | What it detects |
|-------|--------|-----------------|
| **Gap Guard** | `gap_guard_enabled`, `gap_guard_threshold_percent` (default 2%) | Price jump after a data outage exceeding the volatility window |
| **Depth Guard** | `depth_guard_enabled`, `depth_guard_min_usdt` (default 100) | Order book depth below minimum USDT threshold |
| **Session Drift** | `session_drift_guard_enabled`, `session_drift_threshold_percent` (default 3%) | Cumulative price drift from session start, catches staircase evasion |

Guards emit events (`price:gap-alert`, `price:low-depth`, `price:session-drift`) → EmergencyStop triggers hard stop → requires manual `/resume`.

Session base price resets on bot restart or emergency resolve.

### Price Replay & Stress Test Simulator

Standalone CLI tool (`npm run simulate`) for testing pricing logic against historical or synthetic price sequences.

```bash
npm run simulate -- --list                              # List built-in scenarios
npm run simulate -- --scenario flash-crash-5pct         # Run scenario (integration mode)
npm run simulate -- --scenario oscillation --mode unit  # Fast unit mode
npm run simulate -- --file data/snapshot.json           # Replay historical data
npm run simulate -- --scenario flash-crash-5pct --config min_spread=0.01  # Override config
npm run simulate -- --scenario spread-squeeze --output json  # JSON output
```

**Two modes**: unit (pricing logic only, millisecond-fast) and integration (full module stack with mocked externals). Scenarios defined as TypeScript generators or JSON files in `src/simulator/scenarios/`. 11 built-in scenarios covering flash crashes, spread squeeze/inversion, oscillation, slow drift, stale data, thin books, gap bypass, and staircase evasion.

## Bybit P2P API Gotchas

- **SDK pagination is broken** for P2P endpoints. The `BybitClient` has a `rawPost()` method that signs and sends HTTP directly for `getPendingOrders`, `getOrderMessages`, etc.
- **Response format**: P2P uses v3-style `ret_code`/`ret_msg` (not v5's `retCode`/`retMsg`). Normalized via `getRetCode()`/`getRetMsg()` helpers.
- **Status 50 is ambiguous**: Bybit uses it for both completed releases AND cancellations. Code treats 50 as "released" (safe default).
- **Side mapping**: Bybit uses `'1'`=buy, `'0'`=sell internally. Normalized to `'buy'`/`'sell'` strings.

## Environment Variables

Required: `BYBIT_API_KEY`, `BYBIT_API_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

Optional: `BYBIT_TESTNET` (default: `true`), `BYBIT_USER_ID`, `DB_PATH` (default: `./data/bot.db`), `LOG_LEVEL` (default: `info`), `DASHBOARD_PORT` (default: `3000`), `DRY_RUN` (default: `false`)

## Logging

Pino with `createModuleLogger(name)` from `src/utils/logger.ts`. Each module gets a child logger tagged with its name. Pretty output in dev, JSON in prod.

## Testing

Vitest with in-memory SQLite (`:memory:`). Mock external clients (Bybit, CriptoYa, Telegram). Smoke test in `tests/` verifies end-to-end event flow without real API calls.

- `tests/api/` — API route tests (supertest + mock deps)
- `tests/modules/` — Unit tests per module
- `tests/integration/` — Integration tests with real DB, mocked external APIs
- `tests/smoke.test.ts` — End-to-end event flow
- `tests/simulator/` — Simulator engine, guards, generators, mocks, smoke tests

Dashboard typecheck: `cd dashboard && npx tsc --noEmit`
