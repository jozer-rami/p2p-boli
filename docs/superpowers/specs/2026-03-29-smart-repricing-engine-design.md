# Smart Repricing Engine — Design Spec

> Status: Draft
> Date: 2026-03-29
> Inspired by: AutoP2P's 12-phase strategy engine

---

## 1. Overview

A standalone repricing engine that replaces the current ad pricing logic. It fetches the live Bybit P2P order book, filters competitors, detects aggressive pricing, and computes optimal buy/sell prices through a 12-phase pipeline. Supports conservative and aggressive modes with anti-oscillation to prevent price wars.

### Goals

- Filter order book to isolate genuine competitors (5 configurable filters)
- Prevent price wars via aggressive competitor detection and anti-oscillation
- Track position in the filtered order book
- Support conservative (target #3) and aggressive (target #1) modes
- Expose config via REST API (dashboard + Telegram call the same endpoints)
- Send Telegram notifications on position changes and aggressive competitor detection

### Non-Goals

- Telegram commands for config (dashboard-only via REST)
- Multi-platform repricing (Bybit only for now)
- ML-based pricing (deterministic pipeline)

---

## 2. Enriched Order Book Data

### OrderBookAd Interface

```typescript
export interface OrderBookAd {
  id: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;           // available USDT
  minAmount: number;          // min order BOB
  maxAmount: number;          // max order BOB
  nickName: string;
  userId: string;
  recentOrderNum: number;     // trades in last 30 days
  recentExecuteRate: number;  // completion rate 0-100
  authTag: string[];          // ['GA'], ['VA'], etc.
  authStatus: number;         // 2 = KYC verified
  isOnline: boolean;
  userType: string;           // 'PERSONAL' | 'MERCHANT'
}
```

`BybitClient.getOnlineAds()` updated to return `OrderBookAd[]` with all fields parsed from the raw Bybit response. The existing `BybitAd` type stays unchanged for ad creation/management.

---

## 3. Order Book Filters

### Filter Configuration

```typescript
export interface OrderBookFilters {
  minOrderAmount: number;      // Ignore ads with maxAmount < this (BOB). Default: 100
  verifiedOnly: boolean;       // Only KYC-verified (authStatus === 2). Default: true
  minCompletionRate: number;   // Min recentExecuteRate (0-100). Default: 80
  minOrderCount: number;       // Min recentOrderNum. Default: 10
  merchantLevels: string[];    // Allowed authTags. Default: ['GA', 'VA']
}
```

### Filter Pipeline

```
Raw ads (10-20)
  → Exclude own ads (by userId matching BYBIT_USER_ID)
  → Exclude outlier prices (< 8 or > 12 BOB)
  → Filter 1: maxAmount >= minOrderAmount
  → Filter 2: authStatus === 2 (if verifiedOnly)
  → Filter 3: recentExecuteRate >= minCompletionRate
  → Filter 4: recentOrderNum >= minOrderCount
  → Filter 5: authTag intersects merchantLevels
  → Filtered competitors (3-8 genuine ads)
```

### Storage

Filters stored in the existing `config` DB table as key-value pairs. Loaded on engine startup, updated via REST API. Engine holds an in-memory cache that refreshes on PUT.

Config keys:
- `filter_min_order_amount` → `'100'`
- `filter_verified_only` → `'true'`
- `filter_min_completion_rate` → `'80'`
- `filter_min_order_count` → `'10'`
- `filter_merchant_levels` → `'GA,VA'`

---

## 4. The 12-Phase Pipeline

### RepricingResult

```typescript
export interface RepricingResult {
  buyPrice: number;
  sellPrice: number;
  spread: number;
  position: { buy: number; sell: number };
  filteredCompetitors: { buy: number; sell: number };
  action: 'reprice' | 'hold' | 'pause';
  mode: 'conservative' | 'aggressive';
  reason: string;
  phases: PhaseTrace[];  // debugging/analytics
}

export interface PhaseTrace {
  phase: number;
  name: string;
  result: string;
  durationMs: number;
}
```

### Phase Descriptions

**Phase 1 — FETCH**: Call `bybit.getOnlineAds('sell')` and `getOnlineAds('buy')` in parallel. Returns raw `OrderBookAd[]` for both sides. If either fails, return `action: 'hold'` (keep current prices).

**Phase 2 — FILTER**: Apply the 5 filters from config to both sell and buy ad lists. If either filtered list is empty, return `action: 'hold'`.

**Phase 3 — POSITION**: Sort filtered sell ads ascending by price (cheapest first), buy ads descending (highest first). Find where our current ad price would rank. Position is 1-indexed (1 = best).

**Phase 4 — SPREAD**: Calculate `bestAsk` (cheapest filtered seller) and `bestBid` (highest filtered buyer). Spread = bestAsk - bestBid. If spread < `minSpread`, return `action: 'pause'` with reason.

**Phase 5 — VOLUME**: Among filtered competitors, calculate total available quantity per price level. If the top position has < 50 USDT available, it's likely about to be filled — consider the next price level as the effective top.

**Phase 6 — AGGRESSION DETECT**: Sort filtered ads by price. Calculate gaps between consecutive prices. If the gap between position #1 and #2 is > 2× the median gap among the rest, mark position #1 as an aggressive outlier and exclude it from price calculation. Log the detection for Telegram notification.

**Phase 7 — OPTIMAL PRICE**: Based on mode:
- **Conservative** (`target_position: 3`): Price to match the #3 position in filtered book. If fewer than 3 competitors, match #1.
- **Aggressive** (`target_position: 1`): Price 0.001 BOB better than #1 position.
- For buy side: price = target competitor's price + 0.001 (outbid them)
- For sell side: price = target competitor's price - 0.001 (undercut them)

**Phase 8 — SAFETY BOUNDS**: Clamp both prices so that `sellPrice - buyPrice >= minSpread` and `sellPrice - buyPrice <= maxSpread`. Round to 3 decimal places (Bybit BOB limit).

**Phase 9 — PROFITABILITY**: Verify `buyPrice < sellPrice`. If not (inversion), return `action: 'pause'`.

**Phase 10 — ANTI-OSCILLATION**: Compare proposed prices against current ad prices. If `|newPrice - currentPrice| < anti_oscillation_threshold` for both sides, return `action: 'hold'` (skip this cycle). Threshold is configurable, defaults to 0.003 BOB for conservative, 0.001 for aggressive.

**Phase 11 — RETURN**: Package `RepricingResult` with action, prices, position, and reason.

**Phase 12 — LOG**: Emit `reprice:cycle` event with the full result. This feeds Telegram notifications and the dashboard.

---

## 5. Repricing Modes

| Setting | Conservative | Aggressive |
|---------|-------------|------------|
| `target_position` | 3 | 1 |
| `anti_oscillation_threshold` | 0.003 | 0.001 |
| Filter defaults | Strict (90% rate, 20+ orders) | Relaxed (80% rate, 10+ orders) |
| Risk | Lower volume, higher margin | Higher volume, thinner margin |

Mode is stored in DB as `reprice_mode`. Changing mode via REST API also applies the mode's default filter/threshold values (but individual overrides are preserved).

Config keys:
- `reprice_mode` → `'conservative'` or `'aggressive'`
- `anti_oscillation_threshold` → `'0.003'`
- `target_position` → `'3'`

---

## 6. Integration with AdManager

### Simplified tick()

```
AdManager.tick():
  1. result = await engine.reprice(currentAdPrices)
  2. Switch on result.action:
     'reprice' → manageSide('buy', result.buyPrice)
                  manageSide('sell', result.sellPrice)
     'hold'    → skip (log debug)
     'pause'   → removeAllAds(), emit ad:paused
```

AdManager no longer calls `checkBybitMarketSpread()`, `getCurrentPrices()`, or `calculatePricing()`. All pricing intelligence lives in the engine.

AdManager retains:
- Ad lifecycle (create/update/cancel via Bybit API)
- Bank account selection
- Quantity refill (when < 50% of target)
- Pause/resume state (manual, sleep mode)
- Payment method IDs
- Dry run pass-through

### Removed from AdManager

- `checkBybitMarketSpread()` — moved to engine phase 1+4
- `getCurrentPrices()` — replaced by engine phase 7-8
- `lastBybitAsk` / `lastBybitBid` — engine owns this state
- `waitingForSpread` — engine returns 'pause' action instead

### pricing.ts

`src/modules/ad-manager/pricing.ts` becomes unused. The `calculatePricing()` function is fully replaced by the engine. File can be deleted.

---

## 7. REST API Endpoints

### GET /api/repricing/config

Returns all repricing config keys.

```json
{
  "mode": "conservative",
  "targetPosition": 3,
  "antiOscillationThreshold": 0.003,
  "filters": {
    "minOrderAmount": 100,
    "verifiedOnly": true,
    "minCompletionRate": 80,
    "minOrderCount": 10,
    "merchantLevels": ["GA", "VA"]
  }
}
```

### PUT /api/repricing/config

Partial update. Merges provided keys into existing config.

```json
{
  "mode": "aggressive",
  "filters": {
    "minCompletionRate": 70
  }
}
```

### GET /api/repricing/status

Returns the last repricing cycle result.

```json
{
  "action": "hold",
  "buyPrice": 9.338,
  "sellPrice": 9.348,
  "spread": 0.010,
  "position": { "buy": 2, "sell": 3 },
  "filteredCompetitors": { "buy": 5, "sell": 4 },
  "mode": "conservative",
  "reason": "anti-oscillation: price change 0.001 < threshold 0.003",
  "lastCycleAt": "2026-03-29T10:00:00Z"
}
```

### GET /api/repricing/orderbook

Returns the current filtered order book snapshot.

```json
{
  "sell": [
    { "rank": 1, "price": 9.343, "quantity": 1101, "nickName": "Llajta_Capital", "completionRate": 98, "orders": 1500 },
    { "rank": 2, "price": 9.344, "quantity": 498, "nickName": "CRIPTO_GLOBAL", "completionRate": 95, "orders": 800 },
    { "rank": 3, "price": 9.345, "quantity": 300, "nickName": "YOU", "completionRate": 100, "orders": 5 }
  ],
  "buy": [
    { "rank": 1, "price": 9.343, "quantity": 19676, "nickName": "LIVO", "completionRate": 99, "orders": 5000 },
    { "rank": 2, "price": 9.340, "quantity": 1816, "nickName": "cripto.luis.bo", "completionRate": 97, "orders": 2000 }
  ],
  "excludedAggressive": [],
  "totalRaw": { "sell": 12, "buy": 8 },
  "totalFiltered": { "sell": 5, "buy": 4 }
}
```

---

## 8. Telegram Notifications

No Telegram commands — all config via REST/dashboard. But notifications are sent for:

- **Position change** (crosses threshold): "📊 Position changed: SELL #5 → #2 | BUY #3 → #1"
- **Aggressive competitor detected**: "⚠️ Ignoring aggressive competitor X at 9.330 (gap 0.013 vs avg 0.002)"
- **Mode change**: "🔄 Repricing mode changed: conservative → aggressive"
- **Spread pause/resume**: existing `ad:paused` / `ad:resumed` events (already wired)

Position change notifications only fire when the rank changes by >= 2 positions or crosses the target position (e.g., drops from #2 to #5).

---

## 9. New Event

```typescript
'reprice:cycle': {
  action: 'reprice' | 'hold' | 'pause';
  buyPrice: number;
  sellPrice: number;
  spread: number;
  position: { buy: number; sell: number };
  filteredCompetitors: { buy: number; sell: number };
  mode: string;
  reason: string;
}
```

---

## 10. File Structure

```
New:
  src/modules/repricing-engine/
    ├── index.ts          # RepricingEngine class
    ├── filters.ts        # applyFilters(ads, config) → filtered ads
    ├── phases.ts         # Individual phase functions (pure)
    └── types.ts          # OrderBookAd, RepricingResult, Filters, Mode, PhaseTrace
  src/api/routes/repricing.ts  # GET/PUT config, GET status, GET orderbook
  tests/modules/repricing-engine/
    ├── filters.test.ts
    ├── phases.test.ts
    └── index.test.ts

Modified:
  src/bybit/client.ts              # getOnlineAds → OrderBookAd[]
  src/bybit/types.ts                # Add OrderBookAd interface
  src/modules/ad-manager/index.ts   # tick() delegates to engine
  src/event-bus.ts                  # Add reprice:cycle event
  src/db/schema.ts                  # Repricing config keys seeded
  src/index.ts                      # Wire engine, register API routes
  src/modules/telegram/index.ts     # Listen to reprice:cycle

Deleted:
  src/modules/ad-manager/pricing.ts # Replaced by repricing engine
```
