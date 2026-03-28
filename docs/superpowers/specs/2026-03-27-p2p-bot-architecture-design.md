# P2P BOB/USDT Market-Making Bot — Architecture Design

> Status: Draft
> Date: 2026-03-27
> Stack: TypeScript, bybit-api, grammY, SQLite (Drizzle ORM), pino

---

## 1. Overview

A single-process, event-driven bot that automates P2P market making on Bybit. It posts simultaneous buy and sell ads for USDT/BOB, captures the spread as profit, manages multiple bank accounts, and provides full control via Telegram.

### Goals

- Automate ad creation, repricing, and order handling on Bybit P2P
- Monitor cross-platform pricing via CriptoYa API for informed ad pricing
- Manage 5-10 Bolivian bank accounts with balance-aware routing
- Provide full Telegram interface: alerts, dashboard, and controls
- Track P&L per trade and generate daily profit reports
- Semi-automated payment verification (human confirms via Telegram inline buttons)

### Non-Goals (v1)

- Binance P2P automation (use AutoP2P separately if desired)
- Multi-user / multi-tenant support
- Auto-verification of bank payments (Phase 2: mobile automation)
- Cross-platform arbitrage execution
- USDC trading (no liquidity in Bolivia)

---

## 2. Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| Language | TypeScript | Strong typing for financial logic, mature ecosystem |
| Bybit P2P | `bybit-api` (tiagosiebler) | Full P2P types, 335 stars, 5+ years mature, actively maintained |
| Telegram | `grammY` | TypeScript-first, most active TS Telegram lib, v1.41.1 |
| Price monitoring | CriptoYa API (raw fetch) | Free, no auth, simple GET endpoints — SDK not needed |
| Database | SQLite via Drizzle ORM | Zero infra, real queries for P&L, trivial backups |
| Logging | `pino` | Structured JSON, lightweight, fast |
| Runtime | Node.js on Hetzner VPS | Static IP for Bybit API key whitelisting |

---

## 3. Architecture

### Pattern

Modular services with a shared typed event bus. Seven modules in a single process, communicating exclusively through events. No module imports another module directly.

```
┌──────────────────────────────────────────────────────────┐
│                       Main Process                        │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │    Ad    │ │  Order   │ │  Price   │ │ Emergency  │  │
│  │ Manager  │ │ Handler  │ │ Monitor  │ │    Stop    │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘  │
│       │             │            │              │        │
│       └─────────┬───┴────────────┴──────────────┘        │
│               EventBus (typed)                           │
│       ┌─────────┴───┬──────────────┐                     │
│  ┌────┴─────┐ ┌─────┴────┐  ┌──────┴─────┐              │
│  │ Telegram │ │   Bank   │  │  Database  │              │
│  │   Bot    │ │ Manager  │  │  (SQLite)  │              │
│  └──────────┘ └──────────┘  └────────────┘              │
└──────────────────────────────────────────────────────────┘
```

### Module Dependency Rule

Each module receives via constructor injection:
- `EventBus` — to emit and listen to events
- `Database` — to read and write persistent state
- Its own external API client (Bybit, CriptoYa, or Telegram)

No module imports or calls another module. All inter-module communication flows through the event bus.

---

## 4. Modules

### 4.1 PriceMonitor

**Responsibility:** Fetch cross-platform USDT/BOB prices from CriptoYa.

- Polls `GET https://criptoya.com/api/usdt/bob` every 60s
- Fetches fee data every 30min (`GET https://criptoya.com/api/fees`)
- Emits `price:updated` with latest prices and calculated spreads
- Emits `price:spread-alert` when cross-platform opportunities appear
- Tracks price history (rolling window) for volatility detection
- Emits `price:volatility-alert` when price moves exceed threshold within window
- Emits `price:stale` when data hasn't updated in >5 minutes

**External dependency:** CriptoYa API (unauthenticated, 120 req/min)

### 4.2 AdManager

**Responsibility:** Create, reprice, and manage buy/sell ads on Bybit P2P.

- Maintains one buy ad and one sell ad simultaneously
- Listens to `price:updated` to calculate optimal pricing
- Pricing strategy: CriptoYa-informed market rate + configurable min/max spread bounds
- If competitors compress spread below minimum, pauses that side
- Requests bank account from BankManager (via event) for each ad
- Reprices every 30s
- Emits `ad:created`, `ad:repriced`, `ad:paused`, `ad:resumed`

**External dependency:** Bybit P2P API via `bybit-api`

### 4.3 OrderHandler

**Responsibility:** Detect and manage the lifecycle of P2P orders.

- Polls Bybit for pending orders every 5s
- Tracks order state machine:
  ```
  new → awaiting_payment → payment_marked → released
                                          → disputed
       → cancelled (timeout or counterparty)
  ```
- Buy orders: alerts user to pay counterparty, user marks paid via Telegram
- Sell orders: when buyer marks paid, sends Telegram inline buttons for confirmation
- Sets auto-cancel timer for non-paying counterparties (configurable timeout)
- Emits `order:new`, `order:payment-claimed`, `order:released`, `order:cancelled`, `order:disputed`

**External dependency:** Bybit P2P API via `bybit-api`

### 4.4 BankManager

**Responsibility:** Track bank accounts and select the best one for each ad.

- Stores accounts with: name, bank, hint (last 4 digits), estimated balance, daily volume, daily limit, status, priority
- Selection algorithm: filters active accounts with sufficient balance, then picks by highest priority weighted by remaining daily capacity
- Updates estimated balance after each completed trade (inferred from trade amounts)
- Resets daily volume counters at midnight
- Manual balance corrections via Telegram (`/balance banco-union 15000`)
- Emits `bank:low-balance`, `bank:daily-limit`

**External dependency:** None (state in SQLite only)

### 4.5 EmergencyStop

**Responsibility:** Detect dangerous market conditions and halt trading to protect capital.

**Triggers:**
1. **Price volatility** — Price moves >X% within Y minutes (default: 2% in 5 min). PriceMonitor tracks a rolling window and emits `price:volatility-alert`.
2. **Spread inversion** — Current market would cause buy price >= sell price. Detected by AdManager during repricing.
3. **Stale data** — CriptoYa hasn't returned fresh data in >5 minutes. PriceMonitor emits `price:stale`.
4. **Manual trigger** — User sends `/emergency` in Telegram.

**Actions on trigger (in order):**
1. Set bot state to `emergency`
2. Immediately remove ALL ads from Bybit via API (prevents new orders)
3. Keep OrderHandler active (pending orders must still be managed)
4. Keep TelegramBot active (user needs to see what's happening)
5. Stop AdManager and PriceMonitor polling loops
6. Alert via Telegram with full context:
   ```
   EMERGENCY STOP: {reason}

   Trigger: {volatility|spread_inversion|stale_data|manual}
   Market: Bybit ask {ask} / bid {bid} (was {prev_ask}/{prev_bid})
   Change: {percent}% in {minutes} min

   Your exposure:
     USDT: {balance} ({usdt_pct}%)
     BOB:  {balance} ({bob_pct}%)
     Skew: {heavy USDT|heavy BOB|balanced}

   Pending orders: {count} (still active, manage manually)

   Review and /resume when ready.
   ```
7. No auto-resume — requires manual `/resume` after assessment

**Listens to:** `price:volatility-alert`, `price:stale`, `ad:spread-inversion`, `telegram:emergency`
**Emits:** `emergency:triggered`, `emergency:resolved`

**Configurable via Telegram:**
- `/set-volatility-threshold <percent>` — price change % that triggers stop (default: 2%)
- `/set-volatility-window <minutes>` — rolling window for measuring change (default: 5 min)
- `/emergency` — manual trigger
- `/resume` — exit emergency state and restart trading

**External dependency:** None (orchestrates other modules via events)

### 4.6 TelegramBot

**Responsibility:** User interface — alerts, dashboard, and controls.

**Alerts (listens to events):**
- `order:new` → "New {side} order #{id}: {amount} USDT @ {price}"
- `order:payment-claimed` → Inline buttons: `[Confirm & Release]` `[Dispute]`
- `order:released` → "Order #{id} completed. Profit: {spread} BOB"
- `order:cancelled` → "Order #{id} cancelled: {reason}"
- `ad:paused` → "Ad paused ({side}): {reason}"
- `bank:low-balance` → "Low balance on {account}: {balance} BOB"
- `emergency:triggered` → Full emergency report (market state, exposure, pending orders)
- `emergency:resolved` → "Trading resumed. Ads being recreated."
- Errors → any critical error from any module

**Dashboard commands:**
- `/status` — bot state, active ads, pending orders, uptime
- `/balance` — all bank accounts with estimated balances
- `/profit` — today's P&L + 7-day and 30-day summaries
- `/ads` — current ad prices, sides active, last repriced
- `/orders` — pending and recent orders

**Control commands:**
- `/pause` / `/resume` — stop/start all trading
- `/pause-buy` / `/pause-sell` — pause one side
- `/set-min-spread <value>` — minimum spread floor
- `/set-max-spread <value>` — maximum spread ceiling
- `/set-amount <value>` — trade amount in USDT
- `/release <orderId>` — manually release crypto
- `/cancel <orderId>` — manually cancel order
- `/emergency` — trigger emergency stop immediately
- `/set-volatility-threshold <percent>` — volatility trigger (default 2%)
- `/set-volatility-window <minutes>` — rolling window (default 5 min)
- `/add-bank <name> <bank> <hint> <limit>` — add bank account
- `/remove-bank <name>` — deactivate bank account

**Emits:** `telegram:release`, `telegram:dispute`, `telegram:command`

**External dependency:** Telegram Bot API via `grammY`

### 4.7 Database

**Responsibility:** SQLite persistence via Drizzle ORM.

Not a module with a polling loop — a shared service injected into all modules.

---

## 5. Event Bus

### Event Definitions

```typescript
interface EventMap {
  // Price events
  'price:updated':        { prices: PlatformPrices[]; timestamp: number }
  'price:spread-alert':   { platform: string; spread: number; direction: 'buy' | 'sell' }
  'price:volatility-alert': { currentPrice: number; previousPrice: number; changePercent: number; windowMinutes: number }
  'price:stale':          { lastUpdate: number; staleDurationSeconds: number }

  // Ad events
  'ad:created':           { adId: string; side: Side; price: number; bankAccount: string }
  'ad:repriced':          { adId: string; side: Side; oldPrice: number; newPrice: number }
  'ad:paused':            { side: Side; reason: string }
  'ad:resumed':           { side: Side }
  'ad:spread-inversion':  { buyPrice: number; sellPrice: number }

  // Order events
  'order:new':            { orderId: string; side: Side; amount: number; price: number; counterparty: string }
  'order:payment-claimed':{ orderId: string; amount: number; bankAccount: string }
  'order:released':       { orderId: string; amount: number; profit: number }
  'order:cancelled':      { orderId: string; reason: string }
  'order:disputed':       { orderId: string; reason: string }

  // Bank events
  'bank:low-balance':     { accountId: number; balance: number; threshold: number }
  'bank:daily-limit':     { accountId: number; dailyVolume: number; limit: number }
  'bank:balance-updated': { accountId: number; newBalance: number }

  // Emergency events
  'emergency:triggered':  { reason: string; trigger: 'volatility' | 'spread_inversion' | 'stale_data' | 'manual'; marketState: { ask: number; bid: number }; exposure: { usdt: number; bob: number } }
  'emergency:resolved':   { resumedBy: string }

  // Telegram events
  'telegram:release':     { orderId: string }
  'telegram:dispute':     { orderId: string }
  'telegram:emergency':   {}
  'telegram:command':     { command: string; args: string[] }
}
```

### Event Persistence

Every event emitted through the bus is also written to the `event_log` table. This provides:
- Audit trail for every action the bot took
- Debugging — replay what happened before/after an incident
- Analytics — event frequency, timing patterns

---

## 6. Order Lifecycle Flows

### Buy Order (you buy USDT, pay BOB)

```
1. AdManager creates buy ad on Bybit (price=9.33, bank=Banco Union)
2. Counterparty accepts → Bybit escrows their USDT
3. OrderHandler polls, detects new order
   → emits order:new
   → TelegramBot: "New buy order #456: 500 USDT @ 9.33.
      Pay 4,665 BOB to counterparty's account."
4. User transfers BOB via bank app
5. User taps [Mark as Paid] in Telegram
   → OrderHandler calls Bybit mark_as_paid API
6. Counterparty receives BOB, releases USDT from escrow
7. OrderHandler detects completion
   → emits order:released
   → BankManager: balance -4,665 BOB
   → Database: logs trade
   → TelegramBot: "Order #456 completed. +500 USDT, -4,665 BOB"
```

### Sell Order (you sell USDT, receive BOB)

```
1. AdManager creates sell ad on Bybit (price=9.35, bank=Banco Union)
2. Counterparty accepts → Bybit escrows YOUR USDT
3. OrderHandler polls, detects new order
   → emits order:new
   → TelegramBot: "Sell order #789: 500 USDT @ 9.35.
      Awaiting 4,675 BOB to Banco Union ****4521."
4. Counterparty transfers BOB to your bank
5. Counterparty marks payment sent on Bybit
6. OrderHandler detects payment marked
   → emits order:payment-claimed
   → TelegramBot: inline buttons [Confirm & Release] [Dispute]
7. User checks bank app, sees 4,675 BOB arrived
8. User taps [Confirm & Release]
   → telegram:release emitted
   → OrderHandler calls Bybit release API
   → emits order:released
   → BankManager: balance +4,675 BOB
   → Database: logs trade
   → TelegramBot: "Order #789 released. -500 USDT, +4,675 BOB.
      Spread profit: 10 BOB"
```

---

## 7. Database Schema

### trades

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| bybit_order_id | TEXT UNIQUE | Bybit's order identifier |
| side | TEXT | 'buy' or 'sell' |
| amount_usdt | REAL | USDT amount traded |
| price_bob | REAL | BOB per USDT |
| total_bob | REAL | Total BOB moved |
| spread_captured | REAL | BOB profit attributed to this trade |
| counterparty_id | TEXT | Bybit user ID |
| counterparty_name | TEXT | Display name |
| bank_account_id | INTEGER FK | Which bank account was used |
| status | TEXT | completed / cancelled / disputed |
| created_at | INTEGER | Unix timestamp |
| completed_at | INTEGER | Unix timestamp |
| metadata | TEXT | JSON blob for extra Bybit data |

### ads

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| bybit_ad_id | TEXT UNIQUE | Bybit's ad identifier |
| side | TEXT | 'buy' or 'sell' |
| price | REAL | Current price |
| amount_usdt | REAL | Ad amount |
| bank_account_id | INTEGER FK | Bank account shown on ad |
| status | TEXT | active / paused / removed |
| created_at | INTEGER | Unix timestamp |
| updated_at | INTEGER | Unix timestamp |

### bank_accounts

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Display name |
| bank | TEXT | Bank identifier |
| account_hint | TEXT | Last 4 digits |
| balance_bob | REAL | Estimated balance |
| daily_volume | REAL | Today's volume (reset at midnight) |
| daily_limit | REAL | Max BOB per day |
| monthly_volume | REAL | This month's volume |
| status | TEXT | active / paused / frozen |
| priority | INTEGER | Higher = preferred |
| updated_at | INTEGER | Unix timestamp |

### config

| Column | Type | Description |
|--------|------|-------------|
| key | TEXT PK | Config key |
| value | TEXT | Config value |
| updated_at | INTEGER | Unix timestamp |

Default keys: `min_spread`, `max_spread`, `trade_amount_usdt`, `poll_interval_orders`, `poll_interval_ads`, `poll_interval_prices`, `auto_cancel_timeout`, `paused`, `active_sides`, `volatility_threshold_percent`, `volatility_window_minutes`, `bot_state` (running/paused/emergency)

### daily_pnl

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| date | TEXT | YYYY-MM-DD |
| trades_count | INTEGER | Completed trades |
| volume_usdt | REAL | Total USDT traded |
| volume_bob | REAL | Total BOB moved |
| profit_bob | REAL | Net profit in BOB |
| profit_usd | REAL | Estimated USD profit |
| fees_bob | REAL | Any fees incurred |

### event_log

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| event_type | TEXT | Event name from EventMap |
| payload | TEXT | JSON-serialized event data |
| timestamp | INTEGER | Unix timestamp |
| module | TEXT | Source module name |

---

## 8. Polling Intervals

| Module | Interval | Rationale |
|--------|----------|-----------|
| OrderHandler | 5s | Counterparties are waiting; fast response improves completion rate |
| AdManager | 30s | Competitive repricing without excessive API calls |
| PriceMonitor | 60s | Matches CriptoYa's ~60s cache refresh |
| BankManager daily reset | midnight | Resets daily volume counters |
| PnL snapshot | end of day | Computes daily_pnl row from trades table |

### Bybit API Rate Budget

Bybit allows 10 requests/second per API key. Worst-case per 5s cycle:

- OrderHandler: 1-2 calls (list pending + detail if new)
- AdManager (every 30s): 3 calls (read market + update 2 ads)
- Peak: ~5 calls per 5s window — well within limits

---

## 9. Startup & Shutdown

### Startup Sequence

1. Load configuration (.env + DB config table)
2. Initialize Database (run Drizzle migrations if needed)
3. Initialize EventBus
4. Initialize modules (inject EventBus + DB):
   a. BankManager — loads accounts from DB
   b. PriceMonitor — fetches initial prices (await first response)
   c. EmergencyStop — loads volatility config, begins listening to events
   d. AdManager — syncs existing ads from Bybit (recover from restart)
   e. OrderHandler — syncs pending orders from Bybit (recover from restart)
   f. TelegramBot — starts grammY polling
5. Start all polling loops
6. Send Telegram: "Bot started. Sides: {active}, spread: {min}-{max}, accounts: {count}"

### Graceful Shutdown (SIGTERM / SIGINT)

1. Stop all polling loops
2. Remove ads from Bybit (prevent new orders)
3. Log pending orders requiring manual attention
4. Send Telegram: "Bot stopping. {N} pending orders need manual handling."
5. Close DB connection
6. Exit

---

## 10. Error Handling

### Bybit API Errors

| Error | Response |
|-------|----------|
| Rate limited (429) | Exponential backoff (1s → 2s → 4s → max 30s). Auto-resume. |
| Auth failure (401/403) | Stop all trading. Telegram alert. Require manual `/resume`. |
| Server error (5xx) | Retry 3x with backoff. If persistent, pause repricing but keep order monitoring. |
| Network timeout | Same as server error. |

### Order Errors

| Error | Response |
|-------|----------|
| Release fails | Telegram alert with details. NO auto-retry. Require manual action. |
| Mark-as-paid fails | Telegram alert with retry button. |
| Counterparty cancels | Log, update DB, notify Telegram, re-enable ad. |

### CriptoYa Errors

| Error | Response |
|-------|----------|
| API down / stale (>5min) | Fall back to last known prices. Pause repricing. Keep existing ads live. Alert on Telegram. |

### Telegram Errors

| Error | Response |
|-------|----------|
| Can't reach Telegram API | Log locally. Queue alerts and retry. Trading continues — Telegram is UI, not brain. |

### Database Errors

| Error | Response |
|-------|----------|
| Write failure | Critical. Pause trading. Alert via Telegram. Log to stderr. |
| Read failure | Retry. If persistent, pause trading. |

### Recovery Principles

- **Orders are sacred.** If anything fails mid-order, err on the side of NOT releasing crypto.
- **Ads are disposable.** Remove and recreate if repricing fails.
- **Never silently fail.** Every trading-impacting error gets a Telegram alert.
- **Idempotent operations.** Repricing or checking the same order twice is always safe.

---

## 11. Project Structure

```
boli/
├── src/
│   ├── index.ts                  # Entry point — boots modules, wires event bus
│   ├── event-bus.ts              # Typed EventEmitter with EventMap
│   ├── config.ts                 # Env vars + DB config, validation
│   │
│   ├── modules/
│   │   ├── price-monitor/
│   │   │   ├── index.ts          # PriceMonitor class
│   │   │   ├── criptoya.ts       # CriptoYa API client (raw fetch)
│   │   │   └── types.ts          # PlatformPrices, SpreadInfo
│   │   │
│   │   ├── ad-manager/
│   │   │   ├── index.ts          # AdManager class
│   │   │   ├── pricing.ts        # Spread calculation, bounds enforcement
│   │   │   └── types.ts          # AdConfig, PricingStrategy
│   │   │
│   │   ├── order-handler/
│   │   │   ├── index.ts          # OrderHandler class
│   │   │   ├── lifecycle.ts      # Order state machine transitions
│   │   │   └── types.ts          # OrderState, OrderEvent
│   │   │
│   │   ├── bank-manager/
│   │   │   ├── index.ts          # BankManager class
│   │   │   ├── selector.ts       # Account selection algorithm
│   │   │   └── types.ts          # BankAccount, SelectionCriteria
│   │   │
│   │   ├── emergency-stop/
│   │   │   ├── index.ts          # EmergencyStop class
│   │   │   └── types.ts          # EmergencyTrigger, EmergencyState
│   │   │
│   │   └── telegram/
│   │       ├── index.ts          # TelegramBot class (grammY setup)
│   │       ├── commands.ts       # Command handlers
│   │       ├── alerts.ts         # Notification formatters
│   │       └── keyboards.ts      # Inline keyboards (confirm/dispute)
│   │
│   ├── db/
│   │   ├── index.ts              # Drizzle client setup
│   │   ├── schema.ts             # All table definitions
│   │   └── migrations/           # Drizzle migration files
│   │
│   ├── bybit/
│   │   ├── client.ts             # Thin wrapper over bybit-api
│   │   └── types.ts              # Domain type extensions
│   │
│   └── utils/
│       ├── logger.ts             # pino structured logging
│       └── retry.ts              # Generic retry with backoff
│
├── .env                          # Secrets (API keys, bot token)
├── .env.example                  # Template
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── FINANCIAL_ANALYSIS.md
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-03-27-p2p-bot-architecture-design.md
```

### Conventions

- Each module is a folder: `index.ts` (class), supporting files, `types.ts`
- Constructor injection: modules receive EventBus and Database, no singletons
- `bybit/client.ts` wraps `bybit-api` SDK — single place to update if SDK changes
- TypeScript strict mode, path aliases (`@/` → `src/`)

---

## 12. Future Phases

### Phase 2: Automated Payment Verification
- Mobile automation tool (OpenClaw, Appium, or similar) to open banking app
- Read incoming transactions, match against pending orders
- Auto-confirm and release if payment verified
- Pluggable interface: swap manual Telegram confirmation for automated verification

### Phase 3: Binance P2P
- Evaluate AutoP2P ($100/mo) or build custom integration
- Share BankManager and Telegram modules across platforms
- Unified P&L tracking

### Phase 4: Cross-Platform Arbitrage
- Use CriptoYa data to detect cross-platform spread opportunities
- Execute buy on one platform, sell on another
- Factor in withdrawal fees and transfer times
