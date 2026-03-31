# Bot Settings Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unified REST endpoint and dashboard panel exposing all 12 missing bot config keys with hot-reload — changes take effect immediately without restart.

**Architecture:** New `GET/PUT /api/config/bot` route reads/writes the existing `config` DB table and calls module reload methods. Dashboard gets a `BotSettings.tsx` panel on the Overview page. Three modules get `restart()` methods to hot-swap polling intervals.

**Tech Stack:** TypeScript, Express, Drizzle ORM, React, Tailwind, supertest + vitest

**Spec:** `docs/superpowers/specs/2026-03-30-bot-settings-panel-design.md`

---

## File Map

### New files
- `src/api/routes/bot-config.ts` — GET/PUT /api/config/bot
- `dashboard/src/components/BotSettings.tsx` — Settings panel
- `tests/api/bot-config.test.ts` — API route tests

### Modified files
- `src/modules/order-handler/index.ts` — Add `setAutoCancelTimeout()`, `restart()`
- `src/modules/price-monitor/index.ts` — Add `setVolatilityConfig()`, `restart()`
- `src/modules/ad-manager/index.ts` — Add `restart()`
- `src/api/index.ts` — Register bot-config route, expand ApiDeps
- `src/index.ts` — Wire bot-config deps
- `dashboard/src/hooks/useApi.ts` — Add `useBotConfig`, `useUpdateBotConfig`
- `dashboard/src/pages/Overview.tsx` — Add BotSettingsPanel

---

## Task 1: Hot-reload Methods on Modules

**Files:**
- Modify: `src/modules/order-handler/index.ts`
- Modify: `src/modules/price-monitor/index.ts`
- Modify: `src/modules/ad-manager/index.ts`

- [ ] **Step 1: Add methods to OrderHandler**

In `src/modules/order-handler/index.ts`, add two public methods near the existing `start()`/`stop()`:

```typescript
  setAutoCancelTimeout(ms: number): void {
    this.autoCancelTimeoutMs = ms;
    log.info({ autoCancelTimeoutMs: ms }, 'Auto-cancel timeout updated');
  }

  restart(intervalMs: number): void {
    this.stop();
    this.start(intervalMs);
    log.info({ intervalMs }, 'OrderHandler restarted with new interval');
  }
```

- [ ] **Step 2: Add methods to PriceMonitor**

In `src/modules/price-monitor/index.ts`, add two public methods near the existing `start()`/`stop()`:

```typescript
  setVolatilityConfig(updates: { thresholdPercent?: number; windowMinutes?: number }): void {
    if (updates.thresholdPercent !== undefined) this.config.volatilityThresholdPercent = updates.thresholdPercent;
    if (updates.windowMinutes !== undefined) this.config.volatilityWindowMinutes = updates.windowMinutes;
    log.info({ volatilityConfig: this.config }, 'Volatility config updated');
  }

  restart(intervalMs: number): void {
    this.stop();
    this.start(intervalMs);
    log.info({ intervalMs }, 'PriceMonitor restarted with new interval');
  }
```

- [ ] **Step 3: Add restart to AdManager**

In `src/modules/ad-manager/index.ts`, add near the existing `start()`/`stop()`:

```typescript
  restart(intervalMs: number): void {
    this.stop();
    this.start(intervalMs);
    log.info({ intervalMs }, 'AdManager restarted with new interval');
  }
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/order-handler/index.ts src/modules/price-monitor/index.ts src/modules/ad-manager/index.ts
git commit -m "feat(config): add hot-reload methods — restart(), setAutoCancelTimeout(), setVolatilityConfig()"
```

---

## Task 2: Bot Config API Route + Tests

**Files:**
- Create: `src/api/routes/bot-config.ts`
- Create: `tests/api/bot-config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/bot-config.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBotConfigRouter } from '../../src/api/routes/bot-config.js';

function createMockDeps() {
  return {
    getConfig: vi.fn((key: string) => {
      const defaults: Record<string, string> = {
        active_sides: 'both',
        trade_amount_usdt: '300',
        reprice_enabled: 'true',
        auto_cancel_timeout_ms: '900000',
        sleep_start_hour: '23',
        sleep_end_hour: '10',
        volatility_threshold_percent: '2',
        volatility_window_minutes: '5',
        qr_pre_message: 'Hola!',
        poll_interval_orders_ms: '5000',
        poll_interval_ads_ms: '30000',
        poll_interval_prices_ms: '30000',
        bot_state: 'running',
      };
      return defaults[key] ?? '';
    }),
    setConfig: vi.fn(),
    adManager: {
      setPaused: vi.fn(),
      updateConfig: vi.fn(),
      setRepriceEnabled: vi.fn(),
      restart: vi.fn(),
    },
    orderHandler: {
      setAutoCancelTimeout: vi.fn(),
      restart: vi.fn(),
    },
    priceMonitor: {
      setVolatilityConfig: vi.fn(),
      restart: vi.fn(),
    },
    emergencyStop: {
      getState: vi.fn(() => 'running'),
      trigger: vi.fn(),
      resolve: vi.fn(),
    },
  };
}

describe('Bot Config API', () => {
  function createApp(deps = createMockDeps()) {
    const app = express();
    app.use(express.json());
    app.use('/api', createBotConfigRouter(deps as any));
    return { app, deps };
  }

  describe('GET /api/config/bot', () => {
    it('returns grouped config', async () => {
      const { app } = createApp();
      const res = await request(app).get('/api/config/bot');

      expect(res.status).toBe(200);
      expect(res.body.trading.activeSides).toBe('both');
      expect(res.body.trading.tradeAmountUsdt).toBe(300);
      expect(res.body.trading.repriceEnabled).toBe(true);
      expect(res.body.trading.autoCancelTimeoutMs).toBe(900000);
      expect(res.body.schedule.sleepStartHour).toBe(23);
      expect(res.body.schedule.sleepEndHour).toBe(10);
      expect(res.body.volatility.thresholdPercent).toBe(2);
      expect(res.body.volatility.windowMinutes).toBe(5);
      expect(res.body.messaging.qrPreMessage).toBe('Hola!');
      expect(res.body.polling.ordersMs).toBe(5000);
      expect(res.body.botState).toBe('running');
    });
  });

  describe('PUT /api/config/bot', () => {
    it('updates trading config and hot-reloads', async () => {
      const { app, deps } = createApp();
      const res = await request(app)
        .put('/api/config/bot')
        .send({ trading: { activeSides: 'sell', tradeAmountUsdt: 500 } });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(deps.setConfig).toHaveBeenCalledWith('active_sides', 'sell');
      expect(deps.setConfig).toHaveBeenCalledWith('trade_amount_usdt', '500');
      expect(deps.adManager.setPaused).toHaveBeenCalled();
    });

    it('updates polling and restarts modules', async () => {
      const { app, deps } = createApp();
      const res = await request(app)
        .put('/api/config/bot')
        .send({ polling: { ordersMs: 10000, adsMs: 60000 } });

      expect(res.status).toBe(200);
      expect(deps.setConfig).toHaveBeenCalledWith('poll_interval_orders_ms', '10000');
      expect(deps.orderHandler.restart).toHaveBeenCalledWith(10000);
      expect(deps.adManager.restart).toHaveBeenCalledWith(60000);
    });

    it('updates volatility and hot-reloads PriceMonitor', async () => {
      const { app, deps } = createApp();
      const res = await request(app)
        .put('/api/config/bot')
        .send({ volatility: { thresholdPercent: 5 } });

      expect(res.status).toBe(200);
      expect(deps.priceMonitor.setVolatilityConfig).toHaveBeenCalledWith({ thresholdPercent: 5 });
    });

    it('pauses bot when botState set to paused', async () => {
      const { app, deps } = createApp();
      const res = await request(app)
        .put('/api/config/bot')
        .send({ botState: 'paused' });

      expect(res.status).toBe(200);
      expect(deps.adManager.setPaused).toHaveBeenCalledWith('buy', true);
      expect(deps.adManager.setPaused).toHaveBeenCalledWith('sell', true);
    });

    it('resumes bot when botState set to running', async () => {
      const deps = createMockDeps();
      deps.emergencyStop.getState.mockReturnValue('paused');
      const { app } = createApp(deps);

      const res = await request(app)
        .put('/api/config/bot')
        .send({ botState: 'running' });

      expect(res.status).toBe(200);
      expect(deps.adManager.setPaused).toHaveBeenCalledWith('buy', false);
      expect(deps.adManager.setPaused).toHaveBeenCalledWith('sell', false);
    });

    it('returns 400 for empty body', async () => {
      const { app } = createApp();
      const res = await request(app).put('/api/config/bot').send({});
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/bot-config.test.ts`
Expected: FAIL — Cannot find module.

- [ ] **Step 3: Implement bot-config route**

Create `src/api/routes/bot-config.ts`:

```typescript
import { Router } from 'express';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('api:bot-config');

export interface BotConfigDeps {
  getConfig: (key: string) => string;
  setConfig: (key: string, value: string) => void;
  adManager: {
    setPaused: (side: 'buy' | 'sell', paused: boolean) => void;
    updateConfig: (config: { tradeAmountUsdt?: number }) => void;
    setRepriceEnabled: (enabled: boolean) => void;
    restart: (intervalMs: number) => void;
  };
  orderHandler: {
    setAutoCancelTimeout: (ms: number) => void;
    restart: (intervalMs: number) => void;
  };
  priceMonitor: {
    setVolatilityConfig: (config: { thresholdPercent?: number; windowMinutes?: number }) => void;
    restart: (intervalMs: number) => void;
  };
  emergencyStop: {
    getState: () => string;
    trigger: (type: string, reason: string) => void;
    resolve: (by: string) => void;
  };
}

function buildResponse(getConfig: (key: string) => string) {
  return {
    trading: {
      activeSides: getConfig('active_sides'),
      tradeAmountUsdt: parseFloat(getConfig('trade_amount_usdt')),
      repriceEnabled: getConfig('reprice_enabled') === 'true',
      autoCancelTimeoutMs: parseInt(getConfig('auto_cancel_timeout_ms')),
    },
    schedule: {
      sleepStartHour: parseInt(getConfig('sleep_start_hour')),
      sleepEndHour: parseInt(getConfig('sleep_end_hour')),
    },
    volatility: {
      thresholdPercent: parseFloat(getConfig('volatility_threshold_percent')),
      windowMinutes: parseFloat(getConfig('volatility_window_minutes')),
    },
    messaging: {
      qrPreMessage: getConfig('qr_pre_message'),
    },
    polling: {
      ordersMs: parseInt(getConfig('poll_interval_orders_ms')),
      adsMs: parseInt(getConfig('poll_interval_ads_ms')),
      pricesMs: parseInt(getConfig('poll_interval_prices_ms')),
    },
    botState: getConfig('bot_state'),
  };
}

export function createBotConfigRouter(deps: BotConfigDeps): Router {
  const router = Router();

  router.get('/config/bot', (_req, res) => {
    res.json(buildResponse(deps.getConfig));
  });

  router.put('/config/bot', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      res.status(400).json({ error: 'Request body must be a non-empty object' });
      return;
    }

    try {
      // Trading
      if (body.trading) {
        const t = body.trading;
        if (t.activeSides !== undefined) {
          deps.setConfig('active_sides', String(t.activeSides));
          if (t.activeSides === 'sell') {
            deps.adManager.setPaused('buy', true);
            deps.adManager.setPaused('sell', false);
          } else if (t.activeSides === 'buy') {
            deps.adManager.setPaused('sell', true);
            deps.adManager.setPaused('buy', false);
          } else {
            deps.adManager.setPaused('buy', false);
            deps.adManager.setPaused('sell', false);
          }
        }
        if (t.tradeAmountUsdt !== undefined) {
          deps.setConfig('trade_amount_usdt', String(t.tradeAmountUsdt));
          deps.adManager.updateConfig({ tradeAmountUsdt: Number(t.tradeAmountUsdt) });
        }
        if (t.repriceEnabled !== undefined) {
          deps.setConfig('reprice_enabled', String(t.repriceEnabled));
          deps.adManager.setRepriceEnabled(Boolean(t.repriceEnabled));
        }
        if (t.autoCancelTimeoutMs !== undefined) {
          deps.setConfig('auto_cancel_timeout_ms', String(t.autoCancelTimeoutMs));
          deps.orderHandler.setAutoCancelTimeout(Number(t.autoCancelTimeoutMs));
        }
      }

      // Schedule
      if (body.schedule) {
        const s = body.schedule;
        if (s.sleepStartHour !== undefined) deps.setConfig('sleep_start_hour', String(s.sleepStartHour));
        if (s.sleepEndHour !== undefined) deps.setConfig('sleep_end_hour', String(s.sleepEndHour));
      }

      // Volatility
      if (body.volatility) {
        const v = body.volatility;
        const updates: { thresholdPercent?: number; windowMinutes?: number } = {};
        if (v.thresholdPercent !== undefined) {
          deps.setConfig('volatility_threshold_percent', String(v.thresholdPercent));
          updates.thresholdPercent = Number(v.thresholdPercent);
        }
        if (v.windowMinutes !== undefined) {
          deps.setConfig('volatility_window_minutes', String(v.windowMinutes));
          updates.windowMinutes = Number(v.windowMinutes);
        }
        if (Object.keys(updates).length > 0) {
          deps.priceMonitor.setVolatilityConfig(updates);
        }
      }

      // Messaging
      if (body.messaging) {
        if (body.messaging.qrPreMessage !== undefined) {
          deps.setConfig('qr_pre_message', String(body.messaging.qrPreMessage));
        }
      }

      // Polling
      if (body.polling) {
        const p = body.polling;
        if (p.ordersMs !== undefined) {
          deps.setConfig('poll_interval_orders_ms', String(p.ordersMs));
          deps.orderHandler.restart(Number(p.ordersMs));
        }
        if (p.adsMs !== undefined) {
          deps.setConfig('poll_interval_ads_ms', String(p.adsMs));
          deps.adManager.restart(Number(p.adsMs));
        }
        if (p.pricesMs !== undefined) {
          deps.setConfig('poll_interval_prices_ms', String(p.pricesMs));
          deps.priceMonitor.restart(Number(p.pricesMs));
        }
      }

      // Bot state (pause/resume)
      if (body.botState !== undefined) {
        deps.setConfig('bot_state', String(body.botState));
        if (body.botState === 'paused') {
          deps.adManager.setPaused('buy', true);
          deps.adManager.setPaused('sell', true);
        } else if (body.botState === 'running') {
          deps.adManager.setPaused('buy', false);
          deps.adManager.setPaused('sell', false);
          if (deps.emergencyStop.getState() === 'emergency') {
            deps.emergencyStop.resolve('dashboard');
          }
        }
      }

      log.info({ keys: Object.keys(body) }, 'Bot config updated');
      res.json({ ok: true, config: buildResponse(deps.getConfig) });
    } catch (err) {
      log.error({ err }, 'Failed to update bot config');
      res.status(500).json({ error: 'Failed to update bot config' });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api/bot-config.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/bot-config.ts tests/api/bot-config.test.ts
git commit -m "feat(config): bot config API route with hot-reload + 6 unit tests"
```

---

## Task 3: Wire Route into API Server + index.ts

**Files:**
- Modify: `src/api/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Register route in API server**

In `src/api/index.ts`:

1. Add import:
```typescript
import { createBotConfigRouter } from './routes/bot-config.js';
```

2. Add to `ApiDeps` interface:
```typescript
  getConfig: (key: string) => string;
  setConfig: (key: string, value: string) => void;
```

3. After the existing `createConfigRouter` mount, add:
```typescript
  app.use('/api', createBotConfigRouter({
    getConfig: deps.getConfig,
    setConfig: deps.setConfig,
    adManager: deps.adManager,
    orderHandler: deps.orderHandler,
    priceMonitor: deps.priceMonitor,
    emergencyStop: deps.emergencyStop,
  }));
```

- [ ] **Step 2: Pass getConfig/setConfig from index.ts**

In `src/index.ts`, find where `createApiServer` is called and add `getConfig` and `setConfig` to the deps object. These functions already exist in index.ts — they read/write the `config` DB table.

- [ ] **Step 3: Verify typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/api/bot-config.test.ts`
Expected: No errors, 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/api/index.ts src/index.ts
git commit -m "feat(config): wire bot-config route into API server"
```

---

## Task 4: Dashboard Hooks

**Files:**
- Modify: `dashboard/src/hooks/useApi.ts`

- [ ] **Step 1: Add hooks**

In `dashboard/src/hooks/useApi.ts`, add before the `// Guard config` section:

```typescript
// Bot config
export interface BotConfigData {
  trading: {
    activeSides: string;
    tradeAmountUsdt: number;
    repriceEnabled: boolean;
    autoCancelTimeoutMs: number;
  };
  schedule: {
    sleepStartHour: number;
    sleepEndHour: number;
  };
  volatility: {
    thresholdPercent: number;
    windowMinutes: number;
  };
  messaging: {
    qrPreMessage: string;
  };
  polling: {
    ordersMs: number;
    adsMs: number;
    pricesMs: number;
  };
  botState: string;
}

export function useBotConfig() {
  return useQuery({
    queryKey: ['botConfig'],
    queryFn: () => fetchJson<BotConfigData>('/api/config/bot'),
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

- [ ] **Step 2: Verify dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/hooks/useApi.ts
git commit -m "feat(dashboard): add useBotConfig and useUpdateBotConfig hooks"
```

---

## Task 5: BotSettings Dashboard Panel

**Files:**
- Create: `dashboard/src/components/BotSettings.tsx`
- Modify: `dashboard/src/pages/Overview.tsx`

- [ ] **Step 1: Create BotSettings component**

Create `dashboard/src/components/BotSettings.tsx`. Follow the same pattern as GuardConfig.tsx:
- `useState` for local state
- `useEffect` to sync from server
- Dirty detection
- Save button
- Grouped layout as described in the spec

Key sections:
- **Trading**: Active sides (3-way toggle), trade amount, reprice toggle, auto-cancel timeout
- **State**: Current bot state with Pause/Resume button (immediate action, no save)
- **Schedule**: Sleep start/end hours
- **Volatility**: Threshold + window
- **Messaging** (collapsed): QR pre-message
- **Polling** (collapsed): 3 interval inputs

The Pause/Resume button calls `useUpdateBotConfig` directly with `{ botState: 'paused' }` or `{ botState: 'running' }` without waiting for Save.

- [ ] **Step 2: Add to Overview page**

In `dashboard/src/pages/Overview.tsx`:

1. Import: `import BotSettingsPanel from '../components/BotSettings';`
2. Add as the first item in the right column, before RepricingConfigPanel:

```tsx
<BotSettingsPanel />
```

- [ ] **Step 3: Build dashboard**

Run: `cd dashboard && npx vite build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/BotSettings.tsx dashboard/src/pages/Overview.tsx
git commit -m "feat(dashboard): BotSettings panel — trading controls, schedule, volatility, messaging, polling"
```
