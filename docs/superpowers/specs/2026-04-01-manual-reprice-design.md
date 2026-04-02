# Manual Reprice (One-Shot Price Override)

## Summary

Add the ability to manually force an ad price from the dashboard. The forced price takes effect immediately and holds for 4 minutes before the repricing engine resumes automatic control.

## Motivation

Currently all ad prices are set automatically by the RepricingEngine (or the legacy fallback). There is no way to intervene from the dashboard when you spot a market opportunity or want to test a specific price point. This feature adds a quick, low-friction manual override without disrupting the automatic pricing pipeline.

## Design Decisions

- **One-shot, not persistent** — the manual price is applied once and held for a fixed window. It does not change the engine's configuration.
- **4-minute hold** — after forcing a price, the engine skips that side for 4 minutes, then resumes normally.
- **Per-side granularity** — you can force buy, sell, or both independently.
- **Lives in AdManager** — the hold state (timestamp + price) is owned by AdManager since it already owns the tick loop and `manageSide()` calls. No changes to RepricingEngine internals.

## Backend

### AdManager changes (`src/modules/ad-manager/index.ts`)

**New state:**
- `manualHoldUntil: Map<Side, number>` — expiry timestamp per side
- `manualHoldPrice: Map<Side, number>` — the forced price per side

**New method `forceReprice(side: Side, price: number): void`:**
1. Set `manualHoldUntil.set(side, Date.now() + 240_000)`
2. Set `manualHoldPrice.set(side, price)`
3. Call `manageSide(side, price, false)` immediately to update the live ad
4. Emit `ad:manual-reprice` event with `{ side, price, holdUntilMs: 240_000 }`

**New method `clearManualHold(side: Side): void`:**
1. Delete `manualHoldUntil` and `manualHoldPrice` entries for the side

**New method `getManualHold(): Record<Side, { price: number; holdUntil: number } | null>`:**
1. Return current hold state for both sides (null if no hold or expired)

**Tick loop change:**
At the point where the tick calls `manageSide()` for each side, add a guard:
```
if (manualHoldUntil.get(side) > Date.now()) → skip this side
else → clear expired hold, let engine proceed
```

This applies in both the repricing engine path and the legacy fallback path.

**Hold expiry notification:**
When the tick loop clears an expired hold, emit `ad:manual-hold-expired` event with `{ side }`.

### Event bus

Add two event types:
```ts
'ad:manual-reprice': { side: Side; price: number; holdUntilMs: number }
'ad:manual-hold-expired': { side: Side }
```

### Telegram notifications (`src/modules/telegram/alerts.ts`)

Wire both events to Telegram alerts:
- `ad:manual-reprice` → `"🎯 Manual reprice: {side} → {price} BOB (holding 4 min)"`
- `ad:manual-hold-expired` → `"🔄 Manual hold expired ({side}) — engine resumed"`

### API endpoints (`src/api/routes/repricing.ts`)

**`POST /repricing/force`**

Request body (two formats):
```json
{ "side": "sell", "price": 6.95 }
```
```json
{ "buy": 6.92, "sell": 6.95 }
```

Validation:
- Price must be a positive number in range 5-15 (sane BOB/USDT bounds)
- Side must be "buy" or "sell"
- Reject if bot is sleeping or emergency stopped

Response:
```json
{ "ok": true, "side": "sell", "price": 6.95, "holdUntil": "2026-04-01T15:04:00.000Z" }
```

For both-sides format, return an array of results.

**`POST /repricing/force/cancel`**

Request body:
```json
{ "side": "sell" }
```

Accepts `side` values: `"buy"`, `"sell"`, or `"both"`.

Response:
```json
{ "ok": true, "cleared": "sell" }
```

**`GET /repricing/status` (existing — extend)**

Add `manualHold` field to response:
```json
{
  "...existing fields",
  "manualHold": {
    "buy": null,
    "sell": { "price": 6.95, "holdUntil": "2026-04-01T15:04:00.000Z", "remainingMs": 180000 }
  }
}
```

### RepricingDeps update (`src/api/routes/repricing.ts`)

Add `adManager` to `RepricingDeps` interface so the route can call `forceReprice()`, `clearManualHold()`, and `getManualHold()`.

## Dashboard

### UI location

Bottom of the existing `RepricingConfig` panel (`dashboard/src/components/RepricingConfig.tsx`).

### Layout

A "Manual Reprice" section with:
- Two compact inline rows (Buy / Sell), matching the Spread Bounds style (`flex items-center gap-1.5`):
  - `Buy [input] [Force]` / `Sell [input] [Force]`
  - Input pre-filled with the current live ad price (from `GET /repricing/status`)
  - Force button uses existing `text-xs px-3 py-1 rounded` button style
- When a hold is active on a side:
  - Input stays editable — re-forcing resets the 4-minute timer (lets you correct a typo without Cancel)
  - Force button replaced by a static amber badge (`bg-amber-600/20 text-amber-400 font-num text-xs`) showing countdown (e.g., "2:34")
  - Small "Cancel" text link next to badge to clear the hold via `POST /repricing/force/cancel`
- When hold expires: badge disappears, Force button returns

### OperationsStrip indicator (`dashboard/src/components/OperationsStrip.tsx`)

When a manual hold is active for a side, show a `MANUAL` tag next to that side's price in the strip:
- Use `text-amber-400 text-[10px] uppercase font-semibold` to match existing label style
- Placed right after the price value: `Buy 6.920 MANUAL`
- Requires extending the `/api/operations` or `/api/repricing/status` response to include hold state (whichever the strip already consumes)

### API hooks (`dashboard/src/hooks/useApi.ts`)

- `useForceReprice()` — `useMutation` calling `POST /api/repricing/force`, invalidates `repricing-status` query key on success
- `useCancelForceReprice()` — `useMutation` calling `POST /api/repricing/force/cancel`, invalidates `repricing-status` query key on success
- Extend existing `useRepricingStatus()` return type to include `manualHold`

### Countdown behavior

The countdown updates every second using a local `setInterval`. When `remainingMs` hits 0, the badge disappears and the Force button returns. The next status poll confirms the engine has resumed.

## Testing

### Backend tests
- `forceReprice()` sets hold state and calls `manageSide()` immediately
- Tick loop skips sides with active hold
- Tick loop clears expired holds and resumes engine pricing
- `clearManualHold()` removes hold state
- `getManualHold()` returns correct state (active, expired, none)

### API tests
- `POST /repricing/force` with valid single-side payload
- `POST /repricing/force` with valid both-sides payload
- `POST /repricing/force` rejects invalid price (negative, out of range)
- `POST /repricing/force` rejects invalid side
- `POST /repricing/force/cancel` clears hold
- `GET /repricing/status` includes `manualHold` field

### Dashboard
- Type-check passes (`cd dashboard && npx tsc --noEmit`)

## Out of scope

- Persisting manual holds to DB (in-memory only, lost on restart — intentional)
- Telegram command for forcing price (can be added later)
- Configurable hold duration (fixed at 4 minutes)
- Pulsing/animated UI elements (dashboard aesthetic is static and data-dense)
