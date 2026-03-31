# P2P BOB/USDT Market-Making Bot — Project Status

> Last updated: 2026-03-30
> Based on: Architecture spec (03-27), Chat relay (03-28), Repricing engine (03-29), Volatility guards (03-30)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         Main Process                              │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐          │
│  │    Ad    │ │  Order   │ │  Price   │ │ Emergency  │          │
│  │ Manager  │ │ Handler  │ │ Monitor  │ │    Stop    │          │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘          │
│       │             │            │              │                │
│  ┌────┴─────┐       │            │              │                │
│  │Repricing │       │            │              │                │
│  │ Engine   │       │            │              │                │
│  └────┬─────┘       │            │              │                │
│       └─────────┬───┴────────────┴──────────────┘                │
│               EventBus (typed, 28+ events)                       │
│       ┌─────────┴───┬──────────────┬────────────┐                │
│  ┌────┴─────┐ ┌─────┴────┐  ┌─────┴──────┐ ┌───┴────────┐      │
│  │ Telegram │ │   Bank   │  │  Database  │ │    Chat    │      │
│  │   Bot    │ │ Manager  │  │  (SQLite)  │ │   Relay    │      │
│  └──────────┘ └──────────┘  └────────────┘ └────────────┘      │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  API Server (Express + WebSocket) → Dashboard (React)      │  │
│  │  /api/status, /api/orders, /api/trades, /api/prices        │  │
│  │  /api/repricing/config, /api/repricing/status              │  │
│  │  /api/repricing/orderbook, /api/config/guards              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Simulator (synthetic scenarios, mock Bybit, replay)       │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Implemented Features

### Core Bot
| Feature | Status | Notes |
|---------|--------|-------|
| EventBus (typed) | Done | 28+ event types, DB persistence |
| PriceMonitor | Done | CriptoYa + Bybit direct, 30s polling, volatility detection |
| AdManager | Done | Delegates to RepricingEngine, single-ad mode, quantity refill |
| OrderHandler | Done | State machine, 5s polling, auto-cancel |
| BankManager | Done | Balance-aware selection, daily volume tracking |
| EmergencyStop | Done | 7 triggers: volatility, stale, inversion, manual, gap, depth, drift |
| TelegramBot | Done | Alerts, inline keyboards, chat relay, event notifications |
| Database | Done | SQLite + Drizzle ORM, 6 tables |
| Config | Done | Env vars + DB config, REST API updatable |
| Startup/Shutdown | Done | Graceful, keeps ads live on shutdown |

### Smart Repricing Engine (12-phase pipeline)
| Feature | Status | Notes |
|---------|--------|-------|
| 5 order book filters | Done | Min amount, verified, completion rate, order count, merchant level |
| Aggressive competitor detection | Done | Outlier gap > 2× median → excluded |
| Anti-oscillation | Done | Skip API call when price change < threshold |
| Position tracking | Done | Your rank in filtered order book |
| Conservative/aggressive modes | Done | Target position #3 vs #1 |
| Bybit order book pricing | Done | `getOnlineAdsEnriched` with full merchant data |
| REST API | Done | GET/PUT config, GET status, GET orderbook |
| Legacy fallback | Done | Old pricing runs if engine fails |

### Volatility Guards
| Feature | Status | Notes |
|---------|--------|-------|
| Gap guard | Done | Detects price jumps after data outages |
| Depth guard | Done | Pauses when order book is too thin |
| Session drift guard | Done | Catches gradual price drift from session start |

### Chat Relay
| Feature | Status | Notes |
|---------|--------|-------|
| Bybit → Telegram forwarding | Done | Text + images, 10s polling |
| Telegram → Bybit replies | Done | Reply-to-message detection |
| Image download/forward | Done | Inline Telegram photos |
| System/self message filtering | Done | Skips system msgs + own via BYBIT_USER_ID |
| Auto-send QR on sell orders | Done | QR code + payment message |

### Operational Modes
| Feature | Status | Notes |
|---------|--------|-------|
| Dry Run mode | Done | `npm run start:dry`, separate DB (`bot-dry-run.db`) |
| Sleep mode | Done | 11pm-10am BOT, removes/pauses ads |
| Wait mode | Done | Pauses when market spread < min_spread |
| Single-ad mode | Done | Updates existing ad instead of creating new |
| Sell-only / buy-only | Done | `active_sides` config |
| Manual price control | Done | `reprice_enabled` toggle |

### Dashboard (React + Vite + Tailwind)
| Feature | Status | Notes |
|---------|--------|-------|
| Overview page | Done | Bot state, orders, profit, prices, active orders list |
| RepricingStatus bar | Done | Engine action, spread, position, mode, competitor count |
| RepricingConfig panel | Done | Mode toggle, filters, thresholds, spread bounds |
| Market page | Done | Filtered order book (sell + buy tables), aggressive exclusions |
| GuardConfig panel | Done | Gap/depth/drift guard toggles and thresholds |
| ReleasePanel | Done | Order detail with confirm/dispute |
| TradeHistory | Done | Trade list with range filtering |
| ChatView | Done | View and send messages + images |
| BankQrManager | Done | QR upload/delete, bank account management |
| WebSocket | Done | Real-time EventBus forwarding |
| API hooks | Done | useStatus, useOrders, useRepricingStatus, useRepricingOrderbook, useRepricingConfig, etc. |

### Simulator
| Feature | Status | Notes |
|---------|--------|-------|
| Synthetic scenarios | Done | 11 built-in (gap, depth, drift, spread inversion, etc.) |
| Mock Bybit client | Done | Simulates P2P API responses |
| Replay price source | Done | Time-series price replay |
| Unit + integration modes | Done | Test modules in isolation or wired together |

### Profit & Balance Tracking
| Feature | Status | Notes |
|---------|--------|-------|
| Auto balance updates | Done | BOB +/- on order completion |
| USDT balance refresh | Done | Fetches from Bybit after each trade |
| Spread profit calculation | Done | `spreadCaptured` per trade based on engine prices |
| Trade logging | Done | All trades with counterparty, bank, timestamps |

---

## REST API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/status | Bot state, orders, prices, profit |
| GET | /api/orders | Pending orders list |
| GET | /api/orders/:id | Order detail + chat |
| POST | /api/orders/:id/release | Release crypto |
| POST | /api/orders/:id/chat | Send chat message |
| GET | /api/trades | Trade history with range filter |
| GET | /api/prices | Cross-platform prices |
| GET | /api/banks | Bank accounts |
| POST | /api/banks | Create bank account |
| PATCH | /api/banks/:id | Update bank account |
| PUT | /api/banks/:id/qr | Upload QR code |
| GET | /api/repricing/config | Repricing engine config + filters |
| PUT | /api/repricing/config | Update repricing config |
| GET | /api/repricing/status | Last repricing cycle result |
| GET | /api/repricing/orderbook | Filtered order book snapshot |
| GET | /api/config/guards | Volatility guard config |
| PATCH | /api/config/guards | Update guard config |

---

## Bybit API Quirks Discovered

| Issue | Details |
|-------|---------|
| Response format | P2P returns `ret_code`/`ret_msg` (v3), not `retCode`/`retMsg` (v5) |
| Pagination | `/pending/simplifyList` NEVER returns items. Use `/simplifyList` with `page: 1, size: 30` (integers, max 30) |
| SDK bugs | SDK's P2P methods don't paginate correctly. Use `rawPost()` for order listing |
| Status codes | Status `50` = completed (both released AND cancelled) |
| Ad side mapping | `side: 1` = sell, `side: 0` = buy (maker perspective) |
| Chat content types | `'str'` for text, `'pic'` for images (not `'1'`/`'2'`) |
| Chat system messages | `roleType: 'sys'` — must filter out |
| Price precision | BOB prices max 3 decimal places |
| Min amount | Must be in BOB (fiat), not USDT |
| Payment methods | Must pass real payment IDs; `id: -1` (Balance) must be excluded |
| KYC restriction | Can only post ads in KYC-verified country's currency |
| API params | Integer `page`/`size` with max 30. Strings rejected on some endpoints. |
| Auth status | `authStatus: 1` = basic KYC (most merchants), `2` = full KYC |
| Online ads data | Returns 14+ fields per ad including merchant stats, auth tags, order limits |

---

## Test Suite

```
Unit tests:       200+ passing (20+ files)
Failing:          1 pre-existing (API order 404 mock)
Coverage areas:   EventBus, DB, retry, pricing, filters, phases,
                  repricing engine, bank selector, order lifecycle,
                  emergency stop, chat relay, alerts, API routes,
                  simulator scenarios, volatility guards, smoke tests
```

---

## Current Account Status

- **Advertiser tier**: General Advertiser
- **Limits**: 1-3 buy ads, 1-3 sell ads, 20,000 USDT/ad, P2P API enabled
- **Completed trades**: 5 (~800 USDT sold, ~7,471 BOB received)
- **USDT balance**: ~1,508 USDT
- **Bank accounts**: BISA + BNB configured
- **KYC**: Bolivia (BOL)

---

## What's Missing / Can Be Improved

### High Priority
| Item | Description | Effort |
|------|-------------|--------|
| **Live market-making test** | Enable both sides on mainnet with real spread | Config change + monitoring |
| **Multiple ads per side** | GA allows 1-3 ads; post at different price levels | Medium |
| **Fix failing test** | API order 404 mock returns 500 | Small |
| **Hetzner deployment** | Move from local to VPS for 24/7 uptime | Medium |

### Medium Priority
| Item | Description | Effort |
|------|-------------|--------|
| **Dashboard auth** | No authentication on API/dashboard | Medium |
| **P&L daily report** | Automated Telegram summary at midnight | Small |
| **Counterparty blocklist** | Track and avoid problematic counterparties | Small |
| **Simulator update** | Use RepricingEngine instead of legacy calculatePricing | Medium |
| **Cross-platform price alerts** | Notify when Binance/Bitget spreads diverge from Bybit | Small |

### Low Priority / Future Phases
| Item | Description |
|------|-------------|
| **Phase 2: Auto payment verification** | Mobile automation (OpenClaw/Appium) to check bank app |
| **Phase 3: Binance P2P** | AutoP2P ($100/mo) or custom integration |
| **Phase 4: Cross-platform arbitrage** | Buy on one platform, sell on another |
| **Trade analytics** | Spread trends, fill rates, best trading hours |
| **USDC support** | If liquidity improves in Bolivia |

### Technical Debt
| Item | Description |
|------|-------------|
| Consolidate scripts | 8 utility scripts → could be Telegram/dashboard commands |
| DB migrations | Using `CREATE TABLE IF NOT EXISTS` — should use proper Drizzle migrations |
| Error recovery | Could self-throttle API calls on repeated failures |
| pricing.ts | Deprecated but kept for simulator; update simulator to use engine |

---

## File Structure

```
src/                              # 50+ source files
├── index.ts                      # Entry point, module wiring
├── config.ts                     # Env + DB config, dry run support
├── event-bus.ts                  # Typed EventEmitter (28+ events)
├── api/                          # Dashboard API server
│   ├── index.ts, ws.ts, types.ts
│   └── routes/ (status, prices, trades, orders, repricing, guards)
├── bybit/
│   ├── client.ts                 # P2P wrapper: rawPost, dry run, enriched ads
│   └── types.ts                  # BybitAd, OrderBookAd, BybitOrder, etc.
├── db/
│   ├── schema.ts                 # 6 Drizzle tables
│   └── index.ts                  # DB init, migrations, createTestDB
├── modules/
│   ├── ad-manager/               # Ad lifecycle, delegates to repricing engine
│   ├── bank-manager/             # Account selection, balance tracking
│   ├── chat-relay/               # Bybit ↔ Telegram chat bridge
│   ├── emergency-stop/           # 7-trigger market protection
│   ├── order-handler/            # Order lifecycle state machine
│   ├── price-monitor/            # CriptoYa + Bybit + 3 volatility guards
│   ├── repricing-engine/         # 12-phase pipeline (filters, phases, engine)
│   └── telegram/                 # Alerts, keyboards, event notifications
├── simulator/                    # Market simulation engine
│   ├── engine.ts, clock.ts, types.ts
│   ├── mocks/ (MockBybitClient, ReplayPriceSource)
│   ├── output/ (table, JSON formatters)
│   └── scenarios/ (11 built-in synthetic scenarios)
├── scripts/                      # 8 utility/debug scripts
└── utils/
    ├── logger.ts                 # pino
    └── retry.ts                  # Exponential backoff

dashboard/                        # React 19 + Vite + Tailwind
├── src/
│   ├── App.tsx                   # Router: Overview, Market, Trades, ReleasePanel
│   ├── components/
│   │   ├── RepricingStatus.tsx   # Engine status bar (action, spread, position)
│   │   ├── RepricingConfig.tsx   # Mode, filters, thresholds config panel
│   │   ├── GuardConfig.tsx       # Volatility guard toggles
│   │   ├── ChatView.tsx          # P2P chat viewer
│   │   ├── ChatSidebar.tsx       # Slide-in chat panel
│   │   ├── BankQrManager.tsx     # Bank account + QR management
│   │   ├── OrderRow.tsx          # Order list item
│   │   ├── ConfirmDialog.tsx     # Release/dispute confirmation
│   │   └── ConnectionStatus.tsx  # WebSocket indicator
│   ├── hooks/
│   │   ├── useApi.ts             # React Query hooks for all endpoints
│   │   ├── useWebSocket.ts       # Real-time event stream
│   │   └── useChatSidebar.tsx    # Chat sidebar state
│   └── pages/
│       ├── Overview.tsx          # Main dashboard with status + config
│       ├── Market.tsx            # Filtered order book (sell + buy tables)
│       ├── ReleasePanel.tsx      # Order detail + release flow
│       └── TradeHistory.tsx      # Trade log with filtering

tests/                            # 20+ test files, 200+ tests
├── smoke.test.ts                 # End-to-end event flow + repricing
├── db.test.ts, event-bus.test.ts
├── api/ (status, orders, ws)
├── modules/
│   ├── repricing-engine/ (filters, phases, index)
│   ├── bank-manager/ (selector, index)
│   ├── order-handler/ (lifecycle)
│   ├── price-monitor/ (criptoya, index, guards)
│   ├── emergency-stop/ (index)
│   ├── chat-relay/ (index)
│   └── telegram/ (alerts)
├── simulator/ (smoke, guards)
└── utils/ (retry)
```

---

## Commands

```bash
npm start              # Live trading
npm run start:dry      # Dry run (separate DB, no real trades)
npm run build          # Compile TypeScript
npm test               # Run unit tests (vitest)
npm run typecheck      # Type-check only
npm run seed:banks     # Seed bank accounts
npm run simulate       # Run market simulator
```
