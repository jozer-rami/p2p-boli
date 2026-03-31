# Operations View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hybrid operations view — compact strip on Overview + dedicated `/operations` page — showing real-time liquidity/imbalance and pricing/repricing state.

**Architecture:** New `GET /api/operations` route aggregates data from `AdManager.getImbalance()`, `AdManager.getActiveAds()`, and a cached `reprice:cycle` payload. Frontend consumes via React Query (5s poll) + WebSocket for live activity log. 7 new events added to WS broadcaster.

**Tech Stack:** Express route (backend), React 19 + Tailwind + React Query (frontend), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-31-operations-view-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/api/routes/operations.ts` | Create | GET /api/operations route |
| `src/api/ws.ts` | Edit | Add 7 events to FORWARDED_EVENTS |
| `src/api/index.ts` | Edit | Mount operations route, wire deps |
| `src/index.ts` | Edit | Cache last reprice:cycle result, pass to API deps |
| `tests/api/operations.test.ts` | Create | Route unit tests |
| `tests/api/ws.test.ts` | Edit | Verify new events forwarded |
| `dashboard/src/hooks/useApi.ts` | Edit | Add useOperations() hook |
| `dashboard/src/hooks/useWebSocket.ts` | Edit | Invalidate operations, dispatch custom events |
| `dashboard/src/hooks/useActivityLog.ts` | Create | Ring buffer hook for live event log |
| `dashboard/src/components/OperationsStrip.tsx` | Create | Overview strip (replaces RepricingStatus) |
| `dashboard/src/pages/Operations.tsx` | Create | Full operations page |
| `dashboard/src/pages/Overview.tsx` | Edit | Swap RepricingStatus for OperationsStrip |
| `dashboard/src/App.tsx` | Edit | Add /operations route + nav link |
| `dashboard/src/components/RepricingStatus.tsx` | Delete | Replaced by OperationsStrip |

---

### Task 1: Operations API Route

**Files:**
- Create: `src/api/routes/operations.ts`
- Test: `tests/api/operations.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/api/operations.test.ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOperationsRouter } from '../../src/api/routes/operations.js';

function createMockDeps(overrides: Record<string, any> = {}) {
  return {
    adManager: {
      getImbalance: vi.fn().mockReturnValue({
        sellVol: 200, buyVol: 100, net: 100, threshold: 300, pausedSide: null,
      }),
      getActiveAds: vi.fn().mockReturnValue(new Map([
        ['sell', { bybitAdId: 'a1', side: 'sell', price: 9.35, amountUsdt: 150, bankAccountId: 1 }],
        ['buy', { bybitAdId: 'a2', side: 'buy', price: 9.31, amountUsdt: 300, bankAccountId: 1 }],
      ])),
    },
    getLastRepricingResult: vi.fn().mockReturnValue({
      action: 'reprice',
      buyPrice: 9.31,
      sellPrice: 9.35,
      spread: 0.04,
      position: { buy: 3, sell: 2 },
      filteredCompetitors: { buy: 1, sell: 2 },
      mode: 'conservative',
      reason: '',
    }),
    ...overrides,
  };
}

function buildApp(deps = createMockDeps()) {
  const app = express();
  app.use('/api', createOperationsRouter(deps));
  return { app, deps };
}

describe('Operations API', () => {
  it('GET /api/operations returns full response', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(200);

    expect(res.body.imbalance).toEqual({
      sellVol: 200, buyVol: 100, net: 100, threshold: 300, pausedSide: null,
    });
    expect(res.body.ads.sell).toEqual({ price: 9.35, amountUsdt: 150 });
    expect(res.body.ads.buy).toEqual({ price: 9.31, amountUsdt: 300 });
    expect(res.body.repricing.action).toBe('reprice');
    expect(res.body.repricing.spread).toBe(0.04);
  });

  it('returns null repricing when engine has not run', async () => {
    const { app } = buildApp(createMockDeps({
      getLastRepricingResult: vi.fn().mockReturnValue(null),
    }));
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(200);
    expect(res.body.repricing).toBeNull();
  });

  it('returns null ads when none active', async () => {
    const { app } = buildApp(createMockDeps({
      adManager: {
        getImbalance: vi.fn().mockReturnValue({ sellVol: 0, buyVol: 0, net: 0, threshold: 300, pausedSide: null }),
        getActiveAds: vi.fn().mockReturnValue(new Map()),
      },
    }));
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(200);
    expect(res.body.ads.sell).toBeNull();
    expect(res.body.ads.buy).toBeNull();
  });

  it('reflects imbalance paused side', async () => {
    const { app } = buildApp(createMockDeps({
      adManager: {
        getImbalance: vi.fn().mockReturnValue({ sellVol: 400, buyVol: 50, net: 350, threshold: 300, pausedSide: 'sell' }),
        getActiveAds: vi.fn().mockReturnValue(new Map()),
      },
    }));
    const res = await request(app).get('/api/operations');
    expect(res.body.imbalance.pausedSide).toBe('sell');
    expect(res.body.imbalance.net).toBe(350);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/api/operations.test.ts`
Expected: FAIL — `createOperationsRouter` does not exist

- [ ] **Step 3: Write the route**

```typescript
// src/api/routes/operations.ts
import { Router } from 'express';
import type { Side } from '../../event-bus.js';

export interface OperationsDeps {
  adManager: {
    getImbalance: () => {
      sellVol: number;
      buyVol: number;
      net: number;
      threshold: number;
      pausedSide: Side | null;
    };
    getActiveAds: () => Map<Side, { side: Side; price: number; amountUsdt: number }>;
  };
  getLastRepricingResult: () => {
    action: string;
    buyPrice: number;
    sellPrice: number;
    spread: number;
    position: { buy: number; sell: number };
    filteredCompetitors: { buy: number; sell: number };
    mode: string;
    reason: string;
  } | null;
}

export function createOperationsRouter(deps: OperationsDeps): Router {
  const router = Router();

  router.get('/operations', (_req, res) => {
    const imbalance = deps.adManager.getImbalance();
    const activeAds = deps.adManager.getActiveAds();

    const sellAd = activeAds.get('sell');
    const buyAd = activeAds.get('buy');

    res.json({
      imbalance,
      ads: {
        sell: sellAd ? { price: sellAd.price, amountUsdt: sellAd.amountUsdt } : null,
        buy: buyAd ? { price: buyAd.price, amountUsdt: buyAd.amountUsdt } : null,
      },
      repricing: deps.getLastRepricingResult(),
    });
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/api/operations.test.ts`
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/operations.ts tests/api/operations.test.ts
git commit -m "feat(api): operations route — imbalance, ads, repricing state"
```

---

### Task 2: WebSocket Event Additions

**Files:**
- Modify: `src/api/ws.ts:7-17`
- Test: `tests/api/ws.test.ts`

- [ ] **Step 1: Add test for a new event**

Append to `tests/api/ws.test.ts`:

```typescript
  it('forwards ad:paused events to clients', () => {
    const bus = createMockBus();
    const broadcaster = new WebSocketBroadcaster(bus as any);

    const mockClient = { readyState: 1, send: vi.fn() };
    broadcaster.addClient(mockClient as any);

    const handler = bus.handlers.get('ad:paused');
    expect(handler).toBeDefined();
    handler!({ side: 'sell', reason: 'Imbalance: sold 350 USDT more than bought' });

    expect(mockClient.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'ad:paused', payload: { side: 'sell', reason: 'Imbalance: sold 350 USDT more than bought' } })
    );
  });

  it('forwards reprice:cycle events to clients', () => {
    const bus = createMockBus();
    const broadcaster = new WebSocketBroadcaster(bus as any);

    const mockClient = { readyState: 1, send: vi.fn() };
    broadcaster.addClient(mockClient as any);

    const handler = bus.handlers.get('reprice:cycle');
    expect(handler).toBeDefined();
    handler!({ action: 'reprice', buyPrice: 9.31, sellPrice: 9.35, spread: 0.04 });

    expect(mockClient.send).toHaveBeenCalledWith(
      expect.stringContaining('"event":"reprice:cycle"')
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/api/ws.test.ts`
Expected: FAIL — `bus.handlers.get('ad:paused')` is undefined

- [ ] **Step 3: Update FORWARDED_EVENTS in ws.ts**

Replace the `FORWARDED_EVENTS` array in `src/api/ws.ts:7-17`:

```typescript
const FORWARDED_EVENTS: (keyof EventMap)[] = [
  'order:new',
  'order:payment-claimed',
  'order:released',
  'order:cancelled',
  'price:updated',
  'ad:created',
  'ad:repriced',
  'emergency:triggered',
  'emergency:resolved',
  'ad:paused',
  'ad:resumed',
  'ad:spread-inversion',
  'reprice:cycle',
  'price:stale',
  'price:spread-alert',
  'price:low-depth',
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/api/ws.test.ts`
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add src/api/ws.ts tests/api/ws.test.ts
git commit -m "feat(ws): forward 7 new events for operations view"
```

---

### Task 3: Wire Route + Cache Reprice Result

**Files:**
- Modify: `src/api/index.ts:1-17` (imports), `src/api/index.ts:73-81` (mount)
- Modify: `src/index.ts:533-548` (createApiServer call)

- [ ] **Step 1: Add import in api/index.ts**

Add after the `createBotConfigRouter` import:

```typescript
import { createOperationsRouter } from './routes/operations.js';
```

- [ ] **Step 2: Add `getLastRepricingResult` to ApiDeps interface**

In `src/api/index.ts`, add to the `ApiDeps` interface:

```typescript
  getLastRepricingResult: () => any;
```

- [ ] **Step 3: Mount the route**

In `src/api/index.ts`, add after the `createBotConfigRouter` mount (after line 81):

```typescript
  app.use('/api', createOperationsRouter({
    adManager: deps.adManager,
    getLastRepricingResult: deps.getLastRepricingResult,
  }));
```

- [ ] **Step 4: Cache reprice result in src/index.ts**

In `src/index.ts`, add before the `createApiServer` call (before line 533):

```typescript
  // Cache latest reprice:cycle result for operations API
  let lastRepricingResult: any = null;
  bus.on('reprice:cycle', (payload) => {
    lastRepricingResult = payload;
  });
```

- [ ] **Step 5: Pass to createApiServer**

In the `createApiServer({...})` call in `src/index.ts`, add the new dep:

```typescript
    getLastRepricingResult: () => lastRepricingResult,
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All previously passing tests still pass

- [ ] **Step 8: Commit**

```bash
git add src/api/index.ts src/index.ts
git commit -m "feat(api): wire operations route + cache reprice result"
```

---

### Task 4: Frontend — useOperations Hook + WebSocket Updates

**Files:**
- Modify: `dashboard/src/hooks/useApi.ts`
- Modify: `dashboard/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Add OperationsData type and useOperations hook**

Append to `dashboard/src/hooks/useApi.ts`:

```typescript
export interface OperationsData {
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

export function useOperations() {
  return useQuery({
    queryKey: ['operations'],
    queryFn: () => fetchJson<OperationsData>('/api/operations'),
    refetchInterval: 5_000,
  });
}
```

- [ ] **Step 2: Update useWebSocket to invalidate operations and dispatch custom events**

In `dashboard/src/hooks/useWebSocket.ts`, replace the `ws.onmessage` handler body:

```typescript
      ws.onmessage = (e) => {
        try {
          const msg: WsEvent = JSON.parse(e.data);

          if (msg.event.startsWith('order:')) {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['status'] });
          }
          if (msg.event.startsWith('price:')) {
            queryClient.invalidateQueries({ queryKey: ['prices'] });
            queryClient.invalidateQueries({ queryKey: ['status'] });
          }
          if (msg.event.startsWith('ad:') || msg.event.startsWith('emergency:')) {
            queryClient.invalidateQueries({ queryKey: ['status'] });
          }

          // Operations view: invalidate + dispatch for activity log
          if (
            msg.event.startsWith('ad:') ||
            msg.event.startsWith('reprice:') ||
            msg.event === 'price:stale' ||
            msg.event === 'price:spread-alert' ||
            msg.event === 'price:low-depth' ||
            msg.event === 'order:released'
          ) {
            queryClient.invalidateQueries({ queryKey: ['operations'] });
            window.dispatchEvent(new CustomEvent('ops:event', { detail: msg }));
          }

          if (msg.event === 'order:payment-claimed') {
            const p = msg.payload;
            playPing();
            sendBrowserNotification(
              'Payment Received',
              `${p.amount} USDT — check your bank and release`,
              () => { window.location.href = `/order/${p.orderId}`; },
            );
          }
        } catch {}
      };
```

- [ ] **Step 3: Dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/hooks/useApi.ts dashboard/src/hooks/useWebSocket.ts
git commit -m "feat(dashboard): useOperations hook + WS event dispatch"
```

---

### Task 5: Activity Log Hook

**Files:**
- Create: `dashboard/src/hooks/useActivityLog.ts`

- [ ] **Step 1: Write the hook**

```typescript
// dashboard/src/hooks/useActivityLog.ts
import { useEffect, useRef, useState } from 'react';

export interface LogEntry {
  id: number;
  time: string;       // HH:MM:SS
  label: string;
  severity: 'problem' | 'change' | 'info';
  detail: string;
  timestamp: number;
}

const SEVERITY_MAP: Record<string, 'problem' | 'change' | 'info'> = {
  'ad:paused': 'problem',
  'price:stale': 'problem',
  'ad:spread-inversion': 'problem',
  'ad:repriced': 'change',
  'reprice:cycle': 'change',
  'price:spread-alert': 'change',
  'price:low-depth': 'change',
  'ad:resumed': 'info',
  'ad:created': 'info',
  'order:released': 'info',
};

const LABEL_MAP: Record<string, string> = {
  'ad:repriced': 'REPRICE',
  'ad:paused': 'PAUSE',
  'ad:resumed': 'RESUME',
  'ad:created': 'AD NEW',
  'ad:spread-inversion': 'INVERSION',
  'reprice:cycle': 'CYCLE',
  'order:released': 'RELEASE',
  'price:stale': 'STALE',
  'price:spread-alert': 'SPREAD',
  'price:low-depth': 'DEPTH',
};

function formatDetail(event: string, payload: any): string {
  switch (event) {
    case 'ad:repriced':
      return `${payload.side} ${payload.oldPrice?.toFixed(3)} → ${payload.newPrice?.toFixed(3)}`;
    case 'ad:paused':
      return `${payload.side} — ${payload.reason}`;
    case 'ad:resumed':
      return payload.side;
    case 'ad:created':
      return `${payload.side} @ ${payload.price?.toFixed(3)}`;
    case 'ad:spread-inversion':
      return `buy ${payload.buyPrice?.toFixed(3)} / sell ${payload.sellPrice?.toFixed(3)}`;
    case 'reprice:cycle':
      return `${payload.action} — spread ${payload.spread?.toFixed(3)} — ${payload.reason || 'ok'}`;
    case 'order:released':
      return `${payload.side} ${payload.amount} USDT`;
    case 'price:stale':
      return `data stale for ${payload.staleDurationSeconds}s`;
    case 'price:spread-alert':
      return `${payload.platform} spread ${payload.spread?.toFixed(3)}`;
    case 'price:low-depth':
      return `${payload.totalAsk}/${payload.totalBid} USDT (min ${payload.minRequired})`;
    default:
      return JSON.stringify(payload);
  }
}

const MAX_ENTRIES = 100;

export function useActivityLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    function handleOpsEvent(e: Event) {
      const { detail } = e as CustomEvent;
      const { event, payload } = detail;

      // Filter out reprice:cycle hold events
      if (event === 'reprice:cycle' && payload.action === 'hold') return;

      const label = LABEL_MAP[event];
      if (!label) return;

      const now = Date.now();
      const d = new Date(now);
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

      const entry: LogEntry = {
        id: nextId.current++,
        time,
        label,
        severity: SEVERITY_MAP[event] ?? 'info',
        detail: formatDetail(event, payload),
        timestamp: now,
      };

      setLastEventAt(now);
      setEntries((prev) => {
        const next = [entry, ...prev];
        return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
      });
    }

    window.addEventListener('ops:event', handleOpsEvent);
    return () => window.removeEventListener('ops:event', handleOpsEvent);
  }, []);

  return { entries, lastEventAt };
}
```

- [ ] **Step 2: Dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/hooks/useActivityLog.ts
git commit -m "feat(dashboard): activity log hook with ring buffer + severity mapping"
```

---

### Task 6: OperationsStrip Component

**Files:**
- Create: `dashboard/src/components/OperationsStrip.tsx`

- [ ] **Step 1: Write the component**

```tsx
// dashboard/src/components/OperationsStrip.tsx
import { Link } from 'react-router-dom';
import { useOperations } from '../hooks/useApi';

const ACTION_COLOR: Record<string, string> = {
  reprice: 'text-green-400',
  hold: 'text-text-muted',
  pause: 'text-amber-400',
};

function spreadColor(spread: number): string {
  if (spread >= 0.015) return 'text-green-400';
  if (spread > 0) return 'text-amber-400';
  return 'text-red-400';
}

function dotColor(net: number, threshold: number, pausedSide: string | null): string {
  if (pausedSide) return 'bg-red-500';
  if (Math.abs(net) > threshold * 0.8) return 'bg-amber-500';
  return 'bg-green-500';
}

export default function OperationsStrip() {
  const { data } = useOperations();

  if (!data) return null;

  const { imbalance: imb, repricing: rp } = data;
  const total = imb.sellVol + imb.buyVol;
  const buyPct = total > 0 ? (imb.buyVol / total) * 100 : 50;
  const sellPct = total > 0 ? (imb.sellVol / total) * 100 : 50;

  return (
    <div className="border-b border-surface-muted/20 py-2 mb-4 -mt-2">
      {/* Top row */}
      <div className="flex items-baseline gap-6">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${dotColor(imb.net, imb.threshold, imb.pausedSide)}`} />
          <span className="text-text-faint text-xs uppercase">Net</span>
          <span className="font-num text-xs font-semibold">
            {imb.net >= 0 ? '+' : ''}{imb.net.toFixed(0)}
          </span>
          <span className="text-text-faint text-xs">/ {imb.threshold}</span>
        </div>

        {rp ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Buy</span>
              <span className="font-num text-sm">{rp.buyPrice.toFixed(3)}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Sell</span>
              <span className="font-num text-sm">{rp.sellPrice.toFixed(3)}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Spread</span>
              <span className={`font-num text-sm ${spreadColor(rp.spread)}`}>{rp.spread.toFixed(3)}</span>
              <span className="text-text-faint text-xs">BOB</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Engine</span>
              <span className={`font-num text-xs font-semibold uppercase ${ACTION_COLOR[rp.action] ?? 'text-text-faint'}`}>
                {rp.action}
              </span>
            </div>
            {rp.action === 'reprice' && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-text-faint text-xs uppercase">Pos</span>
                <span className="font-num text-sm">
                  <span className="text-amber-400">S</span>#{rp.position.sell}
                  <span className="text-text-faint mx-1">/</span>
                  <span className="text-blue-400">B</span>#{rp.position.buy}
                </span>
              </div>
            )}
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Mode</span>
              <span className="text-xs text-text-muted">{rp.mode}</span>
            </div>
          </>
        ) : (
          <span className="text-text-faint text-xs">Engine starting...</span>
        )}

        <Link to="/operations" className="ml-auto text-xs text-text-faint hover:text-text transition-colors">
          Operations &rarr;
        </Link>
      </div>

      {/* Bottom row — balance bar */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-text-faint text-[10px] font-num">BUY {imb.buyVol.toFixed(0)}</span>
        <div className="flex-1 bg-surface-muted rounded h-1 overflow-hidden flex">
          <div className="bg-blue-400 h-full" style={{ width: `${buyPct}%` }} />
          <div className="bg-amber-400 h-full" style={{ width: `${sellPct}%` }} />
        </div>
        <span className="text-text-faint text-[10px] font-num">SELL {imb.sellVol.toFixed(0)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/OperationsStrip.tsx
git commit -m "feat(dashboard): OperationsStrip component"
```

---

### Task 7: Operations Page

**Files:**
- Create: `dashboard/src/pages/Operations.tsx`

- [ ] **Step 1: Write the page**

```tsx
// dashboard/src/pages/Operations.tsx
import { useOperations } from '../hooks/useApi';
import { useActivityLog, type LogEntry } from '../hooks/useActivityLog';

const ACTION_COLOR: Record<string, string> = {
  reprice: 'text-green-400',
  hold: 'text-text-muted',
  pause: 'text-amber-400',
};

function spreadColor(spread: number): string {
  if (spread >= 0.015) return 'text-green-400';
  if (spread > 0) return 'text-amber-400';
  return 'text-red-400';
}

const SEVERITY_COLOR: Record<string, string> = {
  problem: 'text-red-400',
  change: 'text-amber-400',
  info: 'text-text',
};

function formatLastEvent(ts: number | null): string {
  if (!ts) return 'Last event: never';
  const ago = Math.round((Date.now() - ts) / 1000);
  if (ago < 60) return `Last event: ${ago}s ago`;
  return `Last event: ${Math.round(ago / 60)}m ago`;
}

export default function Operations() {
  const { data, isLoading } = useOperations();
  const { entries, lastEventAt } = useActivityLog();

  if (isLoading || !data) {
    return <div className="text-text-faint">Loading...</div>;
  }

  const { imbalance: imb, ads, repricing: rp } = data;
  const total = imb.sellVol + imb.buyVol;
  const buyPct = total > 0 ? (imb.buyVol / total) * 100 : 50;
  const sellPct = total > 0 ? (imb.sellVol / total) * 100 : 50;

  return (
    <div>
      <div className="grid gap-10" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Left — Liquidity & Imbalance */}
        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Liquidity & Imbalance</h2>

          <div className="flex items-baseline gap-1.5 mb-2">
            <span className="text-text-faint text-xs uppercase">Net</span>
            <span className={`font-num text-lg font-semibold ${imb.net >= 0 ? 'text-amber-400' : 'text-blue-400'}`}>
              {imb.net >= 0 ? '+' : ''}{imb.net.toFixed(0)}
            </span>
            <span className="text-text-faint font-num text-sm">/ {imb.threshold}</span>
          </div>

          {imb.pausedSide && (
            <div className="text-red-400 text-xs mt-1 mb-2">
              {imb.pausedSide} side paused by imbalance limiter
            </div>
          )}

          <div className="flex items-baseline gap-4 mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Sell Vol</span>
              <span className="font-num text-sm text-amber-400">{imb.sellVol.toFixed(0)}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Buy Vol</span>
              <span className="font-num text-sm text-blue-400">{imb.buyVol.toFixed(0)}</span>
            </div>
          </div>

          {/* Balance bar */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-text-faint text-[10px] font-num">BUY {imb.buyVol.toFixed(0)}</span>
            <div className="flex-1 bg-surface-muted rounded h-1.5 overflow-hidden flex">
              <div className="bg-blue-400 h-full" style={{ width: `${buyPct}%` }} />
              <div className="bg-amber-400 h-full" style={{ width: `${sellPct}%` }} />
            </div>
            <span className="text-text-faint text-[10px] font-num">SELL {imb.sellVol.toFixed(0)}</span>
          </div>

          {/* Ad state */}
          <div className="border-t border-surface-muted/20 pt-3">
            {ads.sell || ads.buy ? (
              <div className="flex flex-col gap-2">
                {ads.sell && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-text-faint text-xs uppercase">Sell Ad</span>
                    <span className="font-num text-sm">{ads.sell.amountUsdt.toFixed(0)} USDT</span>
                    <span className="text-text-faint text-xs">@ {ads.sell.price.toFixed(3)}</span>
                  </div>
                )}
                {ads.buy && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-text-faint text-xs uppercase">Buy Ad</span>
                    <span className="font-num text-sm">{ads.buy.amountUsdt.toFixed(0)} USDT</span>
                    <span className="text-text-faint text-xs">@ {ads.buy.price.toFixed(3)}</span>
                  </div>
                )}
              </div>
            ) : (
              <span className="text-text-faint text-sm">No active ads</span>
            )}
          </div>
        </div>

        {/* Right — Pricing & Repricing */}
        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Pricing & Repricing</h2>

          {rp ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-text-faint text-xs uppercase">Buy</span>
                  <span className="font-num text-lg font-semibold text-blue-400">{rp.buyPrice.toFixed(3)}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-text-faint text-xs uppercase">Sell</span>
                  <span className="font-num text-lg font-semibold text-amber-400">{rp.sellPrice.toFixed(3)}</span>
                </div>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-text-faint text-xs uppercase">Spread</span>
                <span className={`font-num text-sm ${spreadColor(rp.spread)}`}>{rp.spread.toFixed(3)}</span>
                <span className="text-text-faint text-xs">BOB</span>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-text-faint text-xs uppercase">Action</span>
                <span className={`font-num text-xs font-semibold uppercase ${ACTION_COLOR[rp.action] ?? 'text-text-faint'}`}>
                  {rp.action}
                </span>
              </div>

              {(rp.action === 'hold' || rp.action === 'pause') && rp.reason && (
                <div className="text-xs text-text-faint truncate" title={rp.reason}>{rp.reason}</div>
              )}

              <div className="flex items-baseline gap-1.5">
                <span className="text-text-faint text-xs uppercase">Pos</span>
                <span className="font-num text-sm">
                  <span className="text-amber-400">S</span>#{rp.position.sell}
                  <span className="text-text-faint mx-1">/</span>
                  <span className="text-blue-400">B</span>#{rp.position.buy}
                </span>
              </div>

              <div className="flex items-baseline gap-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-text-faint text-xs uppercase">Filtered</span>
                  <span className="font-num text-xs text-text-muted">{rp.filteredCompetitors.sell}s / {rp.filteredCompetitors.buy}b</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-text-faint text-xs uppercase">Mode</span>
                  <span className="text-xs text-text-muted">{rp.mode}</span>
                </div>
              </div>
            </div>
          ) : (
            <span className="text-text-faint text-sm">Engine starting...</span>
          )}
        </div>
      </div>

      {/* Activity Log */}
      <div className="mt-8">
        <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Activity</h2>
        {entries.length === 0 ? (
          <div className="text-text-faint text-sm">{formatLastEvent(lastEventAt)}</div>
        ) : (
          <div>
            {entries.map((entry: LogEntry) => (
              <div key={entry.id} className="py-1.5 border-b border-surface-muted/10 flex items-baseline gap-3">
                <span className="font-num text-xs text-text-faint">{entry.time}</span>
                <span className={`text-xs font-semibold uppercase w-20 inline-block ${SEVERITY_COLOR[entry.severity]}`}>
                  {entry.label}
                </span>
                <span className="text-xs text-text-muted">{entry.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Operations.tsx
git commit -m "feat(dashboard): Operations page with liquidity, pricing, activity log"
```

---

### Task 8: Wire Into App + Replace RepricingStatus

**Files:**
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/pages/Overview.tsx`
- Delete: `dashboard/src/components/RepricingStatus.tsx`

- [ ] **Step 1: Add route and nav link in App.tsx**

In `dashboard/src/App.tsx`, add the import:

```typescript
import Operations from './pages/Operations';
```

Add the NavLink after the Trades link:

```tsx
          <NavLink to="/operations" className={linkClass}>Operations</NavLink>
```

Add the Route inside `<Routes>`:

```tsx
          <Route path="/operations" element={<Operations />} />
```

- [ ] **Step 2: Replace RepricingStatus with OperationsStrip in Overview.tsx**

In `dashboard/src/pages/Overview.tsx`, replace:

```typescript
import RepricingStatus from '../components/RepricingStatus';
```

with:

```typescript
import OperationsStrip from '../components/OperationsStrip';
```

Replace `<RepricingStatus />` with `<OperationsStrip />` in the JSX.

- [ ] **Step 3: Delete RepricingStatus.tsx**

```bash
rm dashboard/src/components/RepricingStatus.tsx
```

- [ ] **Step 4: Dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors. (Market page uses `useRepricingStatus` from useApi.ts — that hook remains, only the component is deleted.)

- [ ] **Step 5: Build dashboard**

Run: `cd dashboard && npx vite build`
Expected: Build succeeds

- [ ] **Step 6: Run full backend test suite**

Run: `npm test`
Expected: All previously passing tests still pass

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/App.tsx dashboard/src/pages/Overview.tsx
git rm dashboard/src/components/RepricingStatus.tsx
git commit -m "feat(dashboard): wire /operations route, replace RepricingStatus with OperationsStrip"
```

---

### Task 9: Verify Market Page Still Works

**Files:** None (verification only)

- [ ] **Step 1: Verify Market page imports**

Run: `grep -r 'RepricingStatus' dashboard/src/`
Expected: No results (component fully removed, hook `useRepricingStatus` is NOT imported as `RepricingStatus`)

- [ ] **Step 2: Verify useRepricingStatus hook still exists**

Run: `grep 'useRepricingStatus' dashboard/src/hooks/useApi.ts`
Expected: The function definition is still present

- [ ] **Step 3: Dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Backend typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Full test suite**

Run: `npm test`
Expected: All passing (same count as before these changes)
