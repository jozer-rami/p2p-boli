# P2P BOB/USDT Market-Making Bot — Project Status

> Last updated: 2026-03-29
> Based on: Architecture spec (2026-03-27), Chat relay spec (2026-03-28), live testing sessions

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                       Main Process                            │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐      │
│  │    Ad    │ │  Order   │ │  Price   │ │ Emergency  │      │
│  │ Manager  │ │ Handler  │ │ Monitor  │ │    Stop    │      │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘      │
│       │             │            │              │            │
│       └─────────┬───┴────────────┴──────────────┘            │
│               EventBus (typed, 25 events)                    │
│       ┌─────────┴───┬──────────────┬────────────┐            │
│  ┌────┴─────┐ ┌─────┴────┐  ┌─────┴──────┐ ┌───┴────────┐  │
│  │ Telegram │ │   Bank   │  │  Database  │ │    Chat    │  │
│  │   Bot    │ │ Manager  │  │  (SQLite)  │ │   Relay    │  │
│  └──────────┘ └──────────┘  └────────────┘ └────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  API Server (Express + WebSocket) → Dashboard (React) │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

---

## Implemented Features

### Core Bot (from original spec)
| Feature | Status | Notes |
|---------|--------|-------|
| EventBus (typed) | Done | 25 event types, DB persistence |
| PriceMonitor | Done | CriptoYa API, 30s polling, volatility detection |
| AdManager | Done | CriptoYa-informed pricing, min/max spread, single-ad mode |
| OrderHandler | Done | State machine, 5s polling, auto-cancel |
| BankManager | Done | Balance-aware selection, daily volume tracking |
| EmergencyStop | Done | Volatility, stale data, inversion, manual triggers |
| TelegramBot | Done | 15+ commands, inline keyboards, event alerts |
| Database | Done | SQLite + Drizzle ORM, 6 tables |
| Config | Done | Env vars + DB config, runtime updatable |
| Startup/Shutdown | Done | Graceful, keeps ads live on shutdown |

### Chat Relay (from chat relay spec)
| Feature | Status | Notes |
|---------|--------|-------|
| Bybit → Telegram forwarding | Done | Text + images, 10s polling |
| Telegram → Bybit replies | Done | Reply-to-message detection |
| Image download/forward | Done | Inline Telegram photos |
| System message filtering | Done | Skips Bybit system messages |
| Self-message filtering | Done | Via BYBIT_USER_ID |
| Auto-send QR on sell orders | Done | QR code + payment message |

### Additions (from live testing)
| Feature | Status | Notes |
|---------|--------|-------|
| Dry Run mode | Done | `npm run start:dry`, separate DB |
| Sleep mode | Done | 11pm-10am BOT, removes/pauses ads |
| Wait mode | Done | Pauses when market spread < min_spread |
| Single-ad mode | Done | Updates existing ad instead of creating new |
| Market listing via API | Done | `getOnlineAds` for live order book |
| Ad repricing toggle | Done | `reprice_enabled` config |
| Payment method auto-loading | Done | Fetches from Bybit at startup |
| Startup Telegram report | Done | Ad info, balances, mode indicators |

### Dashboard (added during session)
| Feature | Status | Notes |
|---------|--------|-------|
| API Server (Express) | Done | /api/status, /api/prices, /api/trades, /api/orders |
| WebSocket broadcaster | Done | Real-time EventBus forwarding |
| React + Vite + Tailwind | Done | Overview, ReleasePanel, TradeHistory pages |
| Chat view in dashboard | Done | View and send messages from browser |

### Seed Scripts
| Script | Purpose |
|--------|---------|
| `npm run seed:banks` | Insert/upsert bank accounts with QR paths |
| `src/scripts/market-listing.ts` | View live Bybit P2P order book |
| `src/scripts/check-now.ts` | Check pending orders and ads |
| `src/scripts/update-ad.ts` | Manually update ad price |
| `src/scripts/create-sell-order.ts` | Manually create a sell ad |

---

## Bybit API Quirks Discovered

These are critical findings from live testing that differ from documentation:

| Issue | Details |
|-------|---------|
| Response format | P2P returns `ret_code`/`ret_msg` (v3), not `retCode`/`retMsg` (v5) |
| Pagination | `/pending/simplifyList` NEVER returns items. Use `/simplifyList` with `page: 1, size: 30` (integers, max 30) |
| SDK bugs | SDK's `getP2PPendingOrders()` and `getP2POrders()` don't paginate correctly. Use `rawPost()` |
| Status codes | Status `50` = completed (both released AND cancelled) |
| Ad side mapping | `side: 1` = sell, `side: 0` = buy (maker perspective) |
| Chat content types | `'str'` for text, `'pic'` for images (not `'1'`/`'2'`) |
| Chat system messages | `roleType: 'sys'` — must filter out |
| Price precision | BOB prices max 3 decimal places |
| Min amount | Must be in BOB (fiat), not USDT |
| Payment methods | Must pass real payment IDs; `id: -1` (Balance) must be excluded |
| KYC restriction | Can only post ads in KYC-verified country's currency |
| API params | Some endpoints reject string numbers, others reject integers. Inconsistent. |

---

## Test Suite

```
Unit tests:     79 passing (15 files)
Failing:        3 tests (API order 404 mock issue + integration balance tests need API keys)
Coverage areas: EventBus, DB schema, retry utility, pricing logic,
                bank selector, order lifecycle, emergency stop,
                chat relay, Telegram alerts, API routes, smoke tests
```

---

## Current Account Status

- **Advertiser tier**: General Advertiser (Beginner)
- **Limits**: 1-3 buy ads, 1-3 sell ads, 20,000 USDT/ad
- **P2P API**: Enabled
- **Completed trades**: 5 (~800 USDT sold, ~7,471 BOB received)
- **USDT balance**: ~1,508 USDT
- **Bank accounts**: BISA + BNB configured

---

## What's Missing / Can Be Improved

### High Priority
| Item | Description | Effort |
|------|-------------|--------|
| **Live market-making** | Enable both sides with auto-repricing based on live Bybit order book (not just CriptoYa) | Config change + testing |
| **Profit tracking** | Spread captured per trade pair (buy price vs sell price) not tracked properly yet. `spreadCaptured` always 0 | Medium |
| **Order balance updates** | When orders complete, bot should update bank BOB balance and USDT balance automatically | Medium |
| **Fix failing tests** | 3 tests failing (API order 404, integration balance needing API keys) | Small |

### Medium Priority
| Item | Description | Effort |
|------|-------------|--------|
| **Pricing from Bybit order book** | Use `getOnlineAds` to price competitively vs actual Bybit sellers, not CriptoYa cross-platform average | Medium |
| **Multiple ads** | Now that GA allows 1-3 ads per side, post at different price levels for better fill rate | Medium |
| **Telegram `/market` command** | Show live order book from Telegram | Small |
| **Telegram `/setprice` command** | Manually set ad price from Telegram | Small |
| **P&L daily report** | Automated daily summary sent via Telegram at midnight | Small |
| **Counterparty blocklist** | Track and avoid problematic counterparties | Small |

### Low Priority / Future Phases
| Item | Description |
|------|-------------|
| **Phase 2: Auto payment verification** | Mobile automation (OpenClaw/Appium) to check bank app |
| **Phase 3: Binance P2P** | Add Binance as second platform via AutoP2P or custom integration |
| **Phase 4: Cross-platform arbitrage** | Buy on one platform, sell on another |
| **Hetzner deployment** | Move from local to VPS with static IP, systemd service |
| **Rate limiting** | Track Bybit API usage, stay within 10 req/s |
| **Trade analytics** | Spread trends, fill rates, best trading hours |
| **USDC support** | If liquidity improves in Bolivia |

### Technical Debt
| Item | Description |
|------|-------------|
| Consolidate scripts | 8 test/debug scripts in `src/scripts/` — could be Telegram commands |
| DB migrations | Using `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` try/catch — should use proper Drizzle migrations |
| Error recovery | Bot continues polling on API failures but doesn't reduce frequency (could self-throttle) |
| Integration tests | Framework set up but tests need mocking strategy for Bybit API |
| Dashboard auth | No authentication on the API/dashboard |

---

## File Structure (45 source files + 17 test files)

```
src/
├── index.ts                    # Entry point, module wiring (430+ lines)
├── config.ts                   # Env + DB config
├── event-bus.ts                # Typed EventEmitter (25 events)
├── api/                        # Dashboard API server
│   ├── index.ts, ws.ts, types.ts
│   └── routes/ (status, prices, trades, orders)
├── bybit/
│   ├── client.ts               # Bybit P2P wrapper with rawPost + dry run
│   └── types.ts
├── db/
│   ├── schema.ts               # 6 Drizzle tables
│   └── index.ts                # DB init + migrations
├── modules/
│   ├── ad-manager/             # Ad creation, repricing, wait mode
│   ├── bank-manager/           # Account selection, balance tracking
│   ├── chat-relay/             # Bybit ↔ Telegram chat bridge
│   ├── emergency-stop/         # Market protection
│   ├── order-handler/          # Order lifecycle state machine
│   ├── price-monitor/          # CriptoYa + volatility detection
│   └── telegram/               # Commands, alerts, keyboards
├── scripts/                    # 8 utility/debug scripts
└── utils/
    ├── logger.ts               # pino
    └── retry.ts                # Exponential backoff

dashboard/                      # React + Vite + Tailwind
├── src/
│   ├── App.tsx, main.tsx
│   ├── components/ (ChatView, ConfirmDialog, ConnectionStatus, OrderRow)
│   ├── hooks/ (useApi, useWebSocket)
│   └── pages/ (Overview, ReleasePanel, TradeHistory)
```
