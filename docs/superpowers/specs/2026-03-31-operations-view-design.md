# Operations View — Design Spec

## Summary

Hybrid operations visibility: a compact two-row status strip on the Overview page (replacing the existing RepricingStatus component) with at-a-glance imbalance/pricing metrics, plus a dedicated `/operations` page with side-by-side Liquidity and Pricing sections and a real-time activity log.

## Scope

**In scope:** Liquidity/imbalance state, pricing/repricing state, live activity log for these two domains, WS event additions, replacing RepricingStatus with the new strip.

**Out of scope:** Order lifecycle display (already on Overview), emergency management UI (already via Telegram + Overview), bank events, historical event querying from DB, activity log persistence across page reloads.

## Design System Reference

All UI must follow established dashboard patterns. Key references:

- **Section headings**: `text-xs uppercase text-text-faint tracking-wide mb-3`
- **Inline metrics**: `flex items-baseline gap-1.5` — label `text-text-faint text-xs uppercase`, value `font-num text-sm`
- **Side colors**: Buy `text-blue-400`, Sell `text-amber-400`
- **Action colors**: reprice `text-green-400`, hold `text-text-muted`, pause `text-amber-400`
- **Status dots**: `w-1.5 h-1.5 rounded-full bg-{color}-500`
- **Spread thresholds**: `>= 0.015` green-400, `> 0` amber-400, `<= 0` red-400
- **Containers**: `border border-surface-muted/30 rounded px-4 py-3` (panels only, not nested)
- **Dividers**: `border-b border-surface-muted/20`
- **Empty states**: `text-text-faint text-sm`
- **Loading**: `<div className="text-text-faint">Loading...</div>`

---

## 1. Overview Strip (`OperationsStrip.tsx`)

**Replaces** the existing `RepricingStatus.tsx` component. The strip is a superset — it has everything RepricingStatus shows (engine action, spread, position, prices, mode) plus imbalance data. One strip, not two.

**Layout**: Same strip pattern as RepricingStatus — `border-b border-surface-muted/20 py-2 mb-4 -mt-2`. No card container. Two rows separated by a small gap within the same bottom-bordered strip.

**Top row** (`flex items-baseline gap-6`):
- **Imbalance**: dot `w-1.5 h-1.5 rounded-full` + `font-num text-xs font-semibold` net value + `text-text-faint text-xs` threshold
  - `bg-green-500`: net within threshold
  - `bg-amber-500`: net > 80% of threshold
  - `bg-red-500`: side is paused by imbalance limiter
- **Buy price**: `text-text-faint text-xs uppercase` label "Buy" + `font-num text-sm` value in default text color
- **Sell price**: same pattern, label "Sell"
- **Spread**: `font-num text-sm` with threshold-based color (green-400 / amber-400 / red-400) + `text-text-faint text-xs` "BOB"
- **Action**: `font-num text-xs font-semibold uppercase` with action color (green-400 / text-muted / amber-400)
- **Position**: `font-num text-sm` — `S#{sell}` amber / `B#{buy}` blue (same as RepricingStatus)
- **Mode**: `text-xs text-text-muted`
- **"Operations →"**: `text-xs text-text-faint hover:text-text transition-colors` link, right-aligned with `ml-auto`

**Bottom row** (`flex items-center gap-2 mt-1`):
- Left label: `text-text-faint text-[10px] font-num` `BUY {buyVol}`
- Bar track: `flex-1 bg-surface-muted rounded h-1 overflow-hidden flex`
  - Buy segment: `bg-blue-400` proportional width
  - Sell segment: `bg-amber-400` proportional width
- Right label: `text-text-faint text-[10px] font-num` `SELL {sellVol}`

**Empty states:**
- Repricing null: action area shows `text-text-faint text-xs` "Engine starting..."
- No imbalance data: net shows `0 / 300`, bar empty

**Data source:** `GET /api/operations` polled every 5s via React Query, invalidated on WS events.

---

## 2. Operations Page (`Operations.tsx`)

Route: `/operations`. Added to nav bar.

**Loading state:** `if (isLoading) return <div className="text-text-faint">Loading...</div>`

### Layout

`grid gap-10` with `gridTemplateColumns: '1fr 1fr'` for the two sections (equal weight, matching Market page pattern). Activity log full-width below with `mt-8`.

### 2a. Left Section — Liquidity & Imbalance

Heading: `text-xs uppercase text-text-faint tracking-wide mb-3` — "Liquidity & Imbalance"

Flat layout — metrics use type size and weight for hierarchy, no containment boxes. Each metric row uses `flex items-baseline gap-1.5`.

| Field | Label class | Value class |
|-------|-------------|-------------|
| Net Exposure | `text-text-faint text-xs uppercase` "Net" | `font-num text-lg font-semibold` + side color (amber if positive/sell-heavy, blue if negative/buy-heavy) |
| Threshold | — | `text-text-faint font-num text-sm` `/ 300` inline after net |
| Sell Released Vol | `text-text-faint text-xs uppercase` "Sell Vol" | `font-num text-sm text-amber-400` |
| Buy Released Vol | `text-text-faint text-xs uppercase` "Buy Vol" | `font-num text-sm text-blue-400` |
| Paused Side | — | `text-red-400 text-xs` reason text, hidden when null |
| Sell Ad Remaining | `text-text-faint text-xs uppercase` "Sell Ad" | `font-num text-sm` `{remaining} USDT` + `text-text-faint text-xs` `@ {price}` |
| Buy Ad Remaining | Same pattern | Same pattern |

Visual elements:
- Balance bar (same as Overview strip, `h-1.5` slightly taller)
- Paused reason: `text-red-400 text-xs mt-1` below the relevant volume (no border accent — text color only, matching error patterns)
- Per-ad remaining: thin inline bar `bg-surface-muted rounded h-1 w-20` with fill `bg-amber-400` or `bg-blue-400` proportional to remaining/tradeAmountUsdt

**Empty states:**
- No active ads: `text-text-faint text-sm` "No active ads"
- No released volume: values show `0`, bar empty

### 2b. Right Section — Pricing & Repricing

Heading: `text-xs uppercase text-text-faint tracking-wide mb-3` — "Pricing & Repricing"

Flat layout, same `items-baseline gap-1.5` metric pattern.

| Field | Label | Value |
|-------|-------|-------|
| Buy Price | `text-text-faint text-xs uppercase` "Buy" | `font-num text-lg font-semibold text-blue-400` |
| Sell Price | `text-text-faint text-xs uppercase` "Sell" | `font-num text-lg font-semibold text-amber-400` |
| Spread | `text-text-faint text-xs uppercase` "Spread" | `font-num text-sm` with threshold color: `>= 0.015` green-400, `> 0` amber-400, `<= 0` red-400. Suffix `text-text-faint text-xs` "BOB" |
| Action | `text-text-faint text-xs uppercase` "Action" | `font-num text-xs font-semibold uppercase` — reprice green-400, hold text-muted, pause amber-400 |
| Position | `text-text-faint text-xs uppercase` "Pos" | `font-num text-sm` — `S#{sell}` amber `/ B#{buy}` blue |
| Filtered | `text-text-faint text-xs uppercase` "Filtered" | `font-num text-xs text-text-muted` `{sell}s / {buy}b` |
| Mode | `text-text-faint text-xs uppercase` "Mode" | `text-xs text-text-muted` |
| Reason | — | `text-xs text-text-faint truncate` shown below action only when hold/pause |

**Empty states:**
- Repricing null: `text-text-faint text-sm` "Engine starting..." in place of all fields
- Hold with reason: reason displayed, all other fields still shown

### 2c. Activity Log

Heading: `text-xs uppercase text-text-faint tracking-wide mb-3` — "Activity"

Scrolling feed below both sections. Events arrive via WebSocket and accumulate in a ring buffer (max 100 entries, oldest dropped silently when full). Newest entries on top. Resets on page reload.

**Three-color severity system** (not per-event-type rainbow):

| Severity | Color | Events |
|----------|-------|--------|
| Problem | `text-red-400` | `ad:paused`, `price:stale`, `ad:spread-inversion` |
| Change | `text-amber-400` | `ad:repriced`, `reprice:cycle` (reprice/pause only), `price:spread-alert`, `price:low-depth` |
| Info | `text-text` (default) | `ad:resumed`, `ad:created`, `order:released` |

**Row styling** (matching table pattern):
- Row: `py-1.5 border-b border-surface-muted/10`
- Timestamp: `font-num text-xs text-text-faint` — `HH:MM:SS`
- Label: `text-xs font-semibold uppercase` + severity color — fixed width `w-20 inline-block`
- Detail: `text-xs text-text-muted`

**Event format:**

| WS Event | Log Label | Format |
|----------|-----------|--------|
| `ad:repriced` | REPRICE | `{side} {oldPrice} → {newPrice}` |
| `ad:paused` | PAUSE | `{side} — {reason}` |
| `ad:resumed` | RESUME | `{side}` |
| `ad:created` | AD NEW | `{side} @ {price}` |
| `ad:spread-inversion` | INVERSION | `buy {buyPrice} / sell {sellPrice}` |
| `reprice:cycle` | CYCLE | `{action} — spread {spread} — {reason}` |
| `order:released` | RELEASE | `{side} {amount} USDT` |
| `price:stale` | STALE | `data stale for {staleDurationSeconds}s` |
| `price:spread-alert` | SPREAD | `{platform} spread {spread}` |
| `price:low-depth` | DEPTH | `{totalAsk}/{totalBid} USDT (min {minRequired})` |

**Filtering:** `reprice:cycle` events where `action === 'hold'` are **not logged**. Only `reprice` and `pause` actions appear.

**Empty state:** `text-text-faint text-sm` "Last event: never" or "Last event: 3m ago" — quiet, informative.

---

## 3. Backend Changes

### 3a. New Route: `src/api/routes/operations.ts`

`GET /api/operations`

```typescript
interface OperationsResponse {
  imbalance: {
    sellVol: number;
    buyVol: number;
    net: number;
    threshold: number;
    pausedSide: 'buy' | 'sell' | null;
  };
  ads: {
    sell: { price: number; amountUsdt: number } | null;
    buy: { price: number; amountUsdt: number } | null;
  };
  repricing: {
    action: 'reprice' | 'hold' | 'pause';
    buyPrice: number;
    sellPrice: number;
    spread: number;
    position: { buy: number; sell: number };
    filteredCompetitors: { buy: number; sell: number };
    mode: string;
    reason: string;
  } | null;
}
```

**Dependencies interface:**
```typescript
interface OperationsDeps {
  adManager: {
    getImbalance: () => { sellVol, buyVol, net, threshold, pausedSide };
    getActiveAds: () => Map<Side, ActiveAd>;
  };
  getLastRepricingResult: () => RepriceCyclePayload | null;
}
```

The repricing result is captured by listening to `reprice:cycle` events and caching the latest payload. This listener is set up in `src/index.ts` when wiring the route.

### 3b. WebSocket Event Additions: `src/api/ws.ts`

Add 7 events to `FORWARDED_EVENTS`:

```typescript
const FORWARDED_EVENTS: (keyof EventMap)[] = [
  // Existing (9)
  'order:new',
  'order:payment-claimed',
  'order:released',
  'order:cancelled',
  'price:updated',
  'ad:created',
  'ad:repriced',
  'emergency:triggered',
  'emergency:resolved',
  // New (7)
  'ad:paused',
  'ad:resumed',
  'ad:spread-inversion',
  'reprice:cycle',
  'price:stale',
  'price:spread-alert',
  'price:low-depth',
];
```

### 3c. Mount Route: `src/api/index.ts`

Import `createOperationsRouter`, mount at `/api/operations`, wire deps from existing module instances.

---

## 4. Frontend Changes

### 4a. API Hook: `dashboard/src/hooks/useApi.ts`

```typescript
export function useOperations() {
  return useQuery({
    queryKey: ['operations'],
    queryFn: () => fetchJson<OperationsResponse>('/api/operations'),
    refetchInterval: 5_000,
  });
}
```

### 4b. WebSocket Handler: `dashboard/src/hooks/useWebSocket.ts`

Add to the event handler switch:
- `ad:paused`, `ad:resumed`, `ad:spread-inversion`, `reprice:cycle` → invalidate `['operations']`
- `price:stale`, `price:spread-alert`, `price:low-depth` → invalidate `['operations']`
- All above also dispatched to a custom event (`window.dispatchEvent`) so the Operations page activity log can capture them without polling.

### 4c. Activity Log Hook: `dashboard/src/hooks/useActivityLog.ts`

Custom hook that:
- Listens to `window` custom events dispatched by `useWebSocket`
- Filters out `reprice:cycle` events where `action === 'hold'`
- Accumulates entries in a ring buffer (max 100, oldest dropped silently)
- Tracks timestamp of most recent event for the empty state display
- Returns the entry array + last event timestamp for rendering
- Used only by the Operations page

### 4d. Components

- `dashboard/src/components/OperationsStrip.tsx` — Strip for Overview (replaces RepricingStatus)
- `dashboard/src/pages/Operations.tsx` — Full page with flat sections + log

### 4e. Routing & Wiring: `dashboard/src/App.tsx` + `Overview.tsx`

- Add `<NavLink to="/operations">Operations</NavLink>` to nav (same `linkClass` pattern)
- Add `<Route path="/operations" element={<Operations />} />`
- In Overview: replace `<RepricingStatus />` with `<OperationsStrip />`
- Remove `RepricingStatus` import from Overview

### 4f. Cleanup

- `dashboard/src/components/RepricingStatus.tsx` — Delete after OperationsStrip is wired. The `/api/repricing/status` endpoint and `useRepricingStatus` hook remain (used by Market page).

---

## 5. Testing

### Backend
- `tests/api/operations.test.ts` — Route returns correct shape, handles null repricing result, reflects imbalance state changes, returns null ads when none active
- WS forwarding: verify new events reach connected clients (extend existing `tests/api/ws.test.ts`)

### Frontend
- Manual verification: open `/operations`, trigger events via bot, confirm live updates
- Verify Overview strip renders and links correctly
- Verify RepricingStatus removal doesn't break Market page (still uses `useRepricingStatus`)

---

## 6. File Summary

| File | Action |
|------|--------|
| `src/api/routes/operations.ts` | Create |
| `src/api/ws.ts` | Edit — add 7 events |
| `src/api/index.ts` | Edit — mount route, wire deps |
| `src/index.ts` | Edit — cache last reprice result, pass to route |
| `dashboard/src/hooks/useApi.ts` | Edit — add `useOperations()` |
| `dashboard/src/hooks/useWebSocket.ts` | Edit — handle new events, dispatch custom events |
| `dashboard/src/hooks/useActivityLog.ts` | Create |
| `dashboard/src/components/OperationsStrip.tsx` | Create (replaces RepricingStatus on Overview) |
| `dashboard/src/components/RepricingStatus.tsx` | Delete |
| `dashboard/src/pages/Operations.tsx` | Create |
| `dashboard/src/pages/Overview.tsx` | Edit — replace RepricingStatus with OperationsStrip |
| `dashboard/src/App.tsx` | Edit — add route + nav |
| `tests/api/operations.test.ts` | Create |
