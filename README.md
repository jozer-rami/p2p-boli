# Boli — P2P USDT/BOB Trading Bot

Automated P2P trading bot for USDT/BOB on Bybit with a Telegram control interface and web dashboard.

## What it does

- Creates and manages P2P sell/buy ads on Bybit based on market spread
- Monitors incoming orders and relays chat messages to Telegram
- Auto-sends QR code and payment instructions to buyers
- Tracks bank account balances, daily volume, and profit
- Emergency stop on volatility spikes or stale data
- Web dashboard for order management, trade history, and bank account CRUD

## Quick Start

```bash
# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env with your Bybit API keys and Telegram bot token

# Seed bank accounts
npm run seed:banks

# Start in dev mode (bot + dashboard on port 3000)
npm run dev
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BYBIT_API_KEY` | Yes | — | Bybit API key |
| `BYBIT_API_SECRET` | Yes | — | Bybit API secret |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | — | Telegram chat ID for alerts |
| `BYBIT_TESTNET` | No | `true` | Use Bybit testnet |
| `BYBIT_USER_ID` | No | — | Your Bybit user ID |
| `DB_PATH` | No | `./data/bot.db` | SQLite database path |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `DASHBOARD_PORT` | No | `3000` | Dashboard HTTP port |
| `DRY_RUN` | No | `false` | Simulate trades without real API calls |

## Scripts

```bash
npm run dev              # Dev mode with auto-reload
npm start                # Production run
npm run start:dry        # Dry run mode (no real trades)
npm test                 # Run unit tests
npm run test:integration # Run integration tests
npm run test:watch       # Watch mode tests
npm run typecheck        # TypeScript type-check
npm run seed:banks       # Seed bank accounts from script
npm run build            # Compile to dist/
```

## Architecture

ESM-only TypeScript. Modules communicate through an in-memory EventBus with typed events — no direct imports between modules.

```
src/
  index.ts              # Entry point — wires modules, starts polling loops
  config.ts             # Environment + DB config
  event-bus.ts          # Typed event system
  db/                   # SQLite via Drizzle ORM (WAL mode)
  bybit/                # Bybit API client wrapper
  api/                  # Express server + WebSocket
    routes/             # REST endpoints (status, orders, banks, trades, prices)
  modules/
    order-handler/      # Poll pending orders, detect status changes
    ad-manager/         # Create/reprice/cancel P2P ads
    price-monitor/      # Fetch USDT/BOB prices
    chat-relay/         # Relay Bybit P2P chat <-> Telegram
    bank-manager/       # Account selection, balance tracking
    emergency-stop/     # Circuit breaker
    telegram/           # Grammy bot, commands, alerts

dashboard/              # React 19 + Vite + Tailwind CSS
  src/
    pages/              # Overview, ReleasePanel, TradeHistory
    components/         # ChatSidebar, BankQrManager, OrderRow, etc.
    hooks/              # useApi (React Query), useWebSocket
```

## Dashboard

The web dashboard runs on the same port as the API (default 3000). Features:

- **Overview** — bot status, active orders, profit, bank accounts with QR management
- **Order detail** — chat view, release/dispute actions
- **Trade history** — filterable by date range
- **Bank management** — add/edit/deactivate accounts, upload QR codes

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Bot state, orders, ads, prices, profit |
| GET | `/api/orders` | Active orders |
| GET | `/api/orders/:id` | Single order |
| GET | `/api/orders/:id/chat` | Order chat messages |
| POST | `/api/orders/:id/chat` | Send chat message |
| POST | `/api/orders/:id/release` | Release crypto |
| GET | `/api/banks` | List bank accounts |
| POST | `/api/banks` | Create bank account |
| PATCH | `/api/banks/:id` | Update bank account |
| PUT | `/api/banks/:id/qr` | Upload QR code image |
| DELETE | `/api/banks/:id/qr` | Delete QR code |
| GET | `/api/trades` | Trade history |
| GET | `/api/prices` | Current market prices |

## Tech Stack

- **Runtime**: Node.js + TypeScript (ESM)
- **Database**: SQLite via Drizzle ORM
- **Exchange**: Bybit P2P API (bybit-api SDK + raw HTTP for P2P endpoints)
- **Messaging**: Telegram via Grammy
- **Dashboard**: React 19, React Query, Tailwind CSS, Vite
- **Testing**: Vitest, supertest
- **Logging**: Pino
