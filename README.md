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

## Deployment (Hetzner)

Runs on a Hetzner CPX11 (2 vCPU, 2 GB RAM) at `87.99.134.245` via Docker Compose.

### Server layout

```
/opt/boli/
  .env              # Secrets (not in git)
  data/             # Persisted volume — SQLite DB + QR images
  docker-compose.yml
  Dockerfile
  ...rest of repo
```

### Port allocation

| Port | Service |
|------|---------|
| 3001 | Boli dashboard + API |
| 3030 | Copy-trader dashboard |
| 5432 | PostgreSQL (copy-trader) |
| 9090 | Copy-trader metrics |

### Access

- **Dashboard**: `http://87.99.134.245:3001`
- **API**: `http://87.99.134.245:3001/api/status`
- **WebSocket**: `ws://87.99.134.245:3001/ws`

Access is restricted by Hetzner cloud firewall (`polymarket-bot-fw`). To allow a new IP:

```bash
hcloud firewall add-rule polymarket-bot-fw \
  --direction in --protocol tcp --port 3001 \
  --source-ips <your-ip>/32 \
  --description "Boli dashboard from <location>"
```

### Deploy updates

```bash
./scripts/deploy.sh
# or manually:
ssh root@87.99.134.245 "cd /opt/boli && git pull origin main && docker compose up -d --build"
```

### SSH access

```bash
ssh root@87.99.134.245
```

Deploy key (`~/.ssh/boli_deploy` on server) has read-only access to the repo. SSH config routes `github.com` through this key.

### Common operations

```bash
# Logs
ssh root@87.99.134.245 "docker compose -f /opt/boli/docker-compose.yml logs --tail 50"

# Restart
ssh root@87.99.134.245 "docker compose -f /opt/boli/docker-compose.yml restart"

# Go live (disable dry run)
ssh root@87.99.134.245 "sed -i 's/DRY_RUN=true/DRY_RUN=false/' /opt/boli/.env && docker compose -f /opt/boli/docker-compose.yml restart"

# Check health
ssh root@87.99.134.245 "docker compose -f /opt/boli/docker-compose.yml ps"
```

### Firewall note

The Hetzner cloud firewall (`polymarket-bot-fw`) allowlists IPs per port. If your ISP changes your IP, you'll lose access. Add the new IP with `hcloud firewall add-rule` (see above). Old rules can be cleaned up in the [Hetzner console](https://console.hetzner.cloud/).

## Tech Stack

- **Runtime**: Node.js + TypeScript (ESM)
- **Database**: SQLite via Drizzle ORM
- **Exchange**: Bybit P2P API (bybit-api SDK + raw HTTP for P2P endpoints)
- **Messaging**: Telegram via Grammy
- **Dashboard**: React 19, React Query, Tailwind CSS, Vite
- **Testing**: Vitest, supertest
- **Logging**: Pino
