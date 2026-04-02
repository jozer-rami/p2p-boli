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

### Event bus

Add `ad:manual-reprice` event type:
```ts
'ad:manual-reprice': { side: Side; price: number; holdUntilMs: number }
```

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

**`DELETE /repricing/force?side=sell`**

Clears the manual hold for the given side. Accepts `side=buy`, `side=sell`, or `side=both`.

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
- Two inline rows (Buy / Sell), each with:
  - A number input pre-filled with the current live ad price (from `GET /repricing/status`)
  - A "Force" button
- When a hold is active on a side:
  - Input shows the forced price (read-only while holding)
  - Button replaced by a countdown badge (e.g., "Holding 2:34") with subtle pulsing border
  - Small "Cancel" text link to clear the hold via `DELETE /repricing/force`
- When hold expires: badge disappears, input returns to normal editable state

### API hooks (`dashboard/src/hooks/useApi.ts`)

- `useForceReprice()` — `useMutation` calling `POST /api/repricing/force`, invalidates `repricing-status` query key on success
- `useCancelForceReprice()` — `useMutation` calling `DELETE /api/repricing/force`, invalidates `repricing-status` query key on success
- Extend existing `useRepricingStatus()` return type to include `manualHold`

### Countdown behavior

The countdown updates every second using a local `setInterval`. When `remainingMs` hits 0, the badge disappears and the input becomes editable again. The next status poll confirms the engine has resumed.

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
- `DELETE /repricing/force?side=sell` clears hold
- `GET /repricing/status` includes `manualHold` field

### Dashboard
- Type-check passes (`cd dashboard && npx tsc --noEmit`)

## Out of scope

- Persisting manual holds to DB (in-memory only, lost on restart — intentional)
- Telegram command for forcing price (can be added later)
- Configurable hold duration (fixed at 4 minutes)
