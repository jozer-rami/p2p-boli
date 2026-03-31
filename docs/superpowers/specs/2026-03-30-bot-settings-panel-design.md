# Bot Settings Panel — Design Spec

> Status: Draft
> Date: 2026-03-30

---

## 1. Overview

A unified REST endpoint and dashboard panel that exposes all 12 missing config keys. All settings are hot-reloadable — changes take effect immediately without restarting the bot.

### Goals

- Expose all bot config via `GET/PUT /api/config/bot`
- Dashboard panel with grouped settings on the Overview page
- Hot-reload all settings (no restart required)
- Follow existing patterns (GuardConfig, RepricingConfig)

### Non-Goals

- Config history/versioning
- Per-user settings (single operator)
- Validation beyond type coercion

---

## 2. REST API

### GET /api/config/bot

Returns all bot settings grouped by category.

```json
{
  "trading": {
    "activeSides": "both",
    "tradeAmountUsdt": 300,
    "repriceEnabled": true,
    "autoCancelTimeoutMs": 900000
  },
  "schedule": {
    "sleepStartHour": 23,
    "sleepEndHour": 10
  },
  "volatility": {
    "thresholdPercent": 2,
    "windowMinutes": 5
  },
  "messaging": {
    "qrPreMessage": "Hola! En breve te enviaremos el codigo QR para realizar el pago."
  },
  "polling": {
    "ordersMs": 5000,
    "adsMs": 30000,
    "pricesMs": 30000
  },
  "botState": "running"
}
```

### PUT /api/config/bot

Partial update. Only provided keys are updated. Flat key mapping to DB:

| API key | DB key | Type |
|---------|--------|------|
| `trading.activeSides` | `active_sides` | string: 'buy' \| 'sell' \| 'both' |
| `trading.tradeAmountUsdt` | `trade_amount_usdt` | number |
| `trading.repriceEnabled` | `reprice_enabled` | boolean → 'true'/'false' |
| `trading.autoCancelTimeoutMs` | `auto_cancel_timeout_ms` | number |
| `schedule.sleepStartHour` | `sleep_start_hour` | number (0-23) |
| `schedule.sleepEndHour` | `sleep_end_hour` | number (0-23) |
| `volatility.thresholdPercent` | `volatility_threshold_percent` | number |
| `volatility.windowMinutes` | `volatility_window_minutes` | number |
| `messaging.qrPreMessage` | `qr_pre_message` | string |
| `polling.ordersMs` | `poll_interval_orders_ms` | number |
| `polling.adsMs` | `poll_interval_ads_ms` | number |
| `polling.pricesMs` | `poll_interval_prices_ms` | number |
| `botState` | `bot_state` | string: 'running' \| 'paused' |

Response:

```json
{
  "ok": true,
  "config": { /* full config object after update */ }
}
```

---

## 3. Hot-Reload Mechanism

Each module that caches config gets a reload method. The PUT handler calls the appropriate ones after writing to DB.

| Setting | Module | Reload Method |
|---------|--------|---------------|
| `activeSides` | AdManager | `setPaused('buy', ...)` / `setPaused('sell', ...)` based on value |
| `tradeAmountUsdt` | AdManager | `updateConfig({ tradeAmountUsdt })` |
| `repriceEnabled` | AdManager | `setRepriceEnabled(bool)` |
| `autoCancelTimeoutMs` | OrderHandler | New: `setAutoCancelTimeout(ms)` |
| `sleepStartHour/End` | index.ts sleep scheduler | Already re-reads from DB each 5min check |
| `volatility*` | PriceMonitor | New: `setVolatilityConfig({ thresholdPercent, windowMinutes })` |
| `qrPreMessage` | index.ts QR handler | Already reads from DB per order |
| `polling.ordersMs` | OrderHandler | New: `restart(newIntervalMs)` — clears and re-creates interval |
| `polling.adsMs` | AdManager | New: `restart(newIntervalMs)` — clears and re-creates interval |
| `polling.pricesMs` | PriceMonitor | New: `restart(newIntervalMs)` — clears and re-creates interval |
| `botState` | EmergencyStop + AdManager | Pause: `setPaused('both', true)` + remove ads. Resume: `resolve('dashboard')` |

### New methods needed on existing modules:

**OrderHandler:**
```typescript
setAutoCancelTimeout(ms: number): void {
  this.autoCancelTimeoutMs = ms;
}

restart(intervalMs: number): void {
  this.stop();
  this.start(intervalMs);
}
```

**PriceMonitor:**
```typescript
setVolatilityConfig(config: { thresholdPercent?: number; windowMinutes?: number }): void {
  if (config.thresholdPercent !== undefined) this.config.volatilityThresholdPercent = config.thresholdPercent;
  if (config.windowMinutes !== undefined) this.config.volatilityWindowMinutes = config.windowMinutes;
}

restart(intervalMs: number): void {
  this.stop();
  this.start(intervalMs);
}
```

**AdManager:**
```typescript
restart(intervalMs: number): void {
  this.stop();
  this.start(intervalMs);
}
```

The `restart()` pattern is the same for all three: clear existing interval, create new one with updated timing.

---

## 4. Dashboard Panel: BotSettingsPanel

New component at `dashboard/src/components/BotSettings.tsx`. Placed on Overview page, right column, as the first panel (above RepricingConfig and GuardConfig).

### Layout

```
┌─ Bot Settings ──────────────── [Save] ┐
│                                        │
│  Trading                               │
│  Sides: [BUY] [SELL] [BOTH]           │
│  Amount [300____] USDT                 │
│  Reprice [ON]   Cancel [15____] min    │
│                                        │
│  State: RUNNING  [⏸ Pause]             │
│                                        │
│  Schedule                              │
│  Sleep [23__] - [10__] BOT (UTC-4)     │
│                                        │
│  Volatility                            │
│  Threshold [2____] %  Window [5___] min│
│                                        │
│  ▶ Messaging                           │
│    QR message [________________]       │
│                                        │
│  ▶ Polling                             │
│    Orders [5000__] ms                  │
│    Ads    [30000_] ms                  │
│    Prices [30000_] ms                  │
└────────────────────────────────────────┘
```

- Trading + State always visible (most used)
- Schedule + Volatility always visible
- Messaging + Polling collapsed by default (▶ to expand)
- Same save button pattern as GuardConfig (dirty detection)
- Pause button is immediate (no save needed) — calls PUT with `botState: 'paused'`
- Active sides toggle: three buttons, selected one highlighted

### Hooks

```typescript
export function useBotConfig() {
  return useQuery({
    queryKey: ['botConfig'],
    queryFn: () => fetchJson('/api/config/bot'),
    refetchInterval: 10_000,
  });
}

export function useUpdateBotConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const res = await fetch('/api/config/bot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update bot config');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['botConfig'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}
```

---

## 5. Files

```
New:
  src/api/routes/bot-config.ts         # GET/PUT /api/config/bot
  dashboard/src/components/BotSettings.tsx  # Settings panel

Modified:
  src/modules/order-handler/index.ts   # Add setAutoCancelTimeout(), restart()
  src/modules/price-monitor/index.ts   # Add setVolatilityConfig(), restart()
  src/modules/ad-manager/index.ts      # Add restart()
  src/api/index.ts                     # Register bot-config route
  src/index.ts                         # Wire bot-config deps (module refs)
  dashboard/src/hooks/useApi.ts        # Add useBotConfig, useUpdateBotConfig
  dashboard/src/pages/Overview.tsx     # Add BotSettingsPanel
```
