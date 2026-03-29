# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev mode with auto-reload (tsx watch)
npm start            # Production run (tsx src/index.ts)
npm run build        # Compile TypeScript to dist/
npm test             # Run tests once (vitest run)
npm run test:watch   # Run tests in watch mode
npm run typecheck    # Type-check only (tsc --noEmit)
npm run seed:banks   # Seed bank accounts from script
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
- **BankManager** — Bank account selection, balance tracking
- **EmergencyStop** — Auto-halt on volatility, stale data, or spread inversion

### Order Lifecycle State Machine

Defined in `src/modules/order-handler/lifecycle.ts`:
```
new → awaiting_payment → payment_marked → released | cancelled | disputed
```
Release is triggered manually via Telegram (`/release <orderId>` or inline "Confirm & Release" button).

### Database

SQLite via **Drizzle ORM** with WAL mode. Schema in `src/db/schema.ts`. Tables: `config`, `bank_accounts`, `trades`, `ads`, `daily_pnl`, `event_log`.

Config values (spread, polling intervals, etc.) are stored in the `config` table and seeded on startup from `DEFAULT_CONFIG` in `src/config.ts`.

### Telegram Commands

Registered in `src/modules/telegram/commands.ts`, wired in `src/modules/telegram/index.ts`. To add a command: add handler function in `commands.ts`, add dep to `CommandDeps` interface if needed, register with `this.bot.command()`, wire the dep in `src/index.ts`.

## Bybit P2P API Gotchas

- **SDK pagination is broken** for P2P endpoints. The `BybitClient` has a `rawPost()` method that signs and sends HTTP directly for `getPendingOrders`, `getOrderMessages`, etc.
- **Response format**: P2P uses v3-style `ret_code`/`ret_msg` (not v5's `retCode`/`retMsg`). Normalized via `getRetCode()`/`getRetMsg()` helpers.
- **Status 50 is ambiguous**: Bybit uses it for both completed releases AND cancellations. Code treats 50 as "released" (safe default).
- **Side mapping**: Bybit uses `'1'`=buy, `'0'`=sell internally. Normalized to `'buy'`/`'sell'` strings.

## Environment Variables

Required: `BYBIT_API_KEY`, `BYBIT_API_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

Optional: `BYBIT_TESTNET` (default: `true`), `BYBIT_USER_ID`, `DB_PATH` (default: `./data/bot.db`), `LOG_LEVEL` (default: `info`)

## Logging

Pino with `createModuleLogger(name)` from `src/utils/logger.ts`. Each module gets a child logger tagged with its name. Pretty output in dev, JSON in prod.

## Testing

Vitest with in-memory SQLite (`:memory:`). Mock external clients (Bybit, CriptoYa, Telegram). Smoke test in `tests/` verifies end-to-end event flow without real API calls.
