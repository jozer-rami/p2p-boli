# QR Simulation Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a dry-run API endpoint that returns the exact message sequence the bot would send on a sell order, so we can validate QR auto-send from the dashboard without hitting Bybit.

**Architecture:** Extract the message-building logic from `src/index.ts` into a pure function in `src/modules/qr-flow/build-messages.ts`. A new route `src/api/routes/simulate.ts` exposes `GET /api/simulate/sell-order` that calls this function and returns the sequence. The existing inline handler in `index.ts` is marked as legacy but left untouched.

**Tech Stack:** TypeScript, Express, Vitest, supertest

**Spec:** `docs/superpowers/specs/2026-03-29-qr-simulation-endpoint-design.md`

---

### File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/modules/qr-flow/build-messages.ts` | Create | Pure function: account + config → message steps |
| `tests/modules/qr-flow/build-messages.test.ts` | Create | Unit tests for the pure function |
| `src/api/routes/simulate.ts` | Create | `GET /api/simulate/sell-order` endpoint |
| `tests/api/simulate.test.ts` | Create | Endpoint tests (supertest) |
| `src/api/index.ts` | Modify | Mount simulate router |
| `src/index.ts` | Modify | Add legacy comment to inline handler |

---

### Task 1: Pure Function — `buildSellOrderMessages()`

**Files:**
- Create: `src/modules/qr-flow/build-messages.ts`
- Create: `tests/modules/qr-flow/build-messages.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/qr-flow/build-messages.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildSellOrderMessages } from '../../../src/modules/qr-flow/build-messages.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

import { existsSync } from 'fs';

const baseAccount = {
  name: 'Banco Union Personal',
  bank: 'banco-union',
  accountHint: '4521',
  qrCodePath: './data/qr/banco-union-4521.png',
  paymentMessage: 'Pagar a Banco Union ****4521',
};

const baseConfig = {
  qrPreMessage: 'Hola! En breve te enviaremos el codigo QR para realizar el pago.',
};

describe('buildSellOrderMessages', () => {
  it('returns 3 steps when account has QR and payment message', () => {
    const result = buildSellOrderMessages({
      account: baseAccount,
      config: baseConfig,
      orderParams: { amount: 100, price: 6.96 },
    });

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toEqual({ step: 1, type: 'text', content: baseConfig.qrPreMessage });
    expect(result.messages[1]).toEqual({ step: 2, type: 'image', path: './data/qr/banco-union-4521.png', exists: true });
    expect(result.messages[2]).toEqual({ step: 3, type: 'text', content: 'Pagar a Banco Union ****4521' });
  });

  it('skips image step when qrCodePath is null', () => {
    const result = buildSellOrderMessages({
      account: { ...baseAccount, qrCodePath: null },
      config: baseConfig,
      orderParams: { amount: 100, price: 6.96 },
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ step: 1, type: 'text', content: baseConfig.qrPreMessage });
    expect(result.messages[1]).toEqual({ step: 2, type: 'text', content: 'Pagar a Banco Union ****4521' });
  });

  it('uses fallback payment message when paymentMessage is null', () => {
    const result = buildSellOrderMessages({
      account: { ...baseAccount, paymentMessage: null },
      config: baseConfig,
      orderParams: { amount: 100, price: 6.96 },
    });

    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.type).toBe('text');
    expect((lastMsg as any).content).toBe(
      'Please pay 696.00 BOB to Banco Union Personal (banco-union) ****4521'
    );
  });

  it('uses default orderParams when omitted', () => {
    const result = buildSellOrderMessages({
      account: { ...baseAccount, paymentMessage: null },
      config: baseConfig,
    });

    const lastMsg = result.messages[result.messages.length - 1];
    expect((lastMsg as any).content).toContain('696.00 BOB');
  });

  it('marks exists: false when QR file is missing from disk', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);

    const result = buildSellOrderMessages({
      account: baseAccount,
      config: baseConfig,
    });

    const imageStep = result.messages.find((m) => m.type === 'image');
    expect(imageStep).toBeDefined();
    expect((imageStep as any).exists).toBe(false);
  });

  it('adds warning when QR file is missing from disk', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);

    const result = buildSellOrderMessages({
      account: baseAccount,
      config: baseConfig,
    });

    expect(result.warnings).toContain('QR file not found on disk');
  });

  it('adds warning when paymentMessage is null', () => {
    const result = buildSellOrderMessages({
      account: { ...baseAccount, paymentMessage: null },
      config: baseConfig,
    });

    expect(result.warnings).toContain('No custom payment message — using generated fallback');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/modules/qr-flow/build-messages.test.ts`
Expected: FAIL — cannot resolve `../../../src/modules/qr-flow/build-messages.js`

- [ ] **Step 3: Implement `buildSellOrderMessages()`**

Create `src/modules/qr-flow/build-messages.ts`:

```typescript
import { existsSync } from 'fs';

export interface AccountInput {
  name: string;
  bank: string;
  accountHint: string;
  qrCodePath: string | null;
  paymentMessage: string | null;
}

export interface BuildMessagesConfig {
  qrPreMessage: string;
}

export interface OrderParams {
  amount: number;
  price: number;
}

export type MessageStep =
  | { step: number; type: 'text'; content: string }
  | { step: number; type: 'image'; path: string; exists: boolean };

export interface BuildMessagesResult {
  messages: MessageStep[];
  warnings: string[];
}

const DEFAULT_ORDER_PARAMS: OrderParams = { amount: 100, price: 6.96 };

export function buildSellOrderMessages(input: {
  account: AccountInput;
  config: BuildMessagesConfig;
  orderParams?: OrderParams;
}): BuildMessagesResult {
  const { account, config, orderParams = DEFAULT_ORDER_PARAMS } = input;
  const messages: MessageStep[] = [];
  const warnings: string[] = [];
  let step = 1;

  // 1. Pre-QR greeting
  messages.push({ step: step++, type: 'text', content: config.qrPreMessage });

  // 2. QR image (if available)
  if (account.qrCodePath) {
    const fileExists = existsSync(account.qrCodePath);
    if (!fileExists) {
      warnings.push('QR file not found on disk');
    }
    messages.push({ step: step++, type: 'image', path: account.qrCodePath, exists: fileExists });
  }

  // 3. Payment instructions
  if (!account.paymentMessage) {
    warnings.push('No custom payment message — using generated fallback');
  }
  const paymentContent = account.paymentMessage
    || `Please pay ${(orderParams.amount * orderParams.price).toFixed(2)} BOB to ${account.name} (${account.bank}) ****${account.accountHint}`;
  messages.push({ step: step++, type: 'text', content: paymentContent });

  return { messages, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/modules/qr-flow/build-messages.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/qr-flow/build-messages.ts tests/modules/qr-flow/build-messages.test.ts
git commit -m "feat: add buildSellOrderMessages pure function with tests"
```

---

### Task 2: Simulation Endpoint — `GET /api/simulate/sell-order`

**Files:**
- Create: `src/api/routes/simulate.ts`
- Create: `tests/api/simulate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/simulate.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSimulateRouter } from '../../src/api/routes/simulate.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

const mockAccounts = [
  {
    id: 1,
    name: 'Banco Union Personal',
    bank: 'banco-union',
    accountHint: '4521',
    balanceBob: 5000,
    dailyVolume: 1200,
    dailyLimit: 10000,
    monthlyVolume: 30000,
    status: 'active',
    priority: 1,
    qrCodePath: './data/qr/banco-union-4521.png',
    paymentMessage: 'Pagar a Banco Union ****4521',
  },
  {
    id: 2,
    name: 'Banco Mercantil',
    bank: 'banco-mercantil',
    accountHint: '7823',
    balanceBob: 3000,
    dailyVolume: 800,
    dailyLimit: 8000,
    monthlyVolume: 20000,
    status: 'inactive',
    priority: 0,
    qrCodePath: null,
    paymentMessage: null,
  },
];

function createMockDeps() {
  return {
    bankManager: {
      getAccountById: vi.fn((id: number) => mockAccounts.find((a) => a.id === id)),
    },
    qrPreMessage: 'Hola! En breve te enviaremos el codigo QR para realizar el pago.',
  };
}

function buildApp(deps = createMockDeps()) {
  const app = express();
  app.use(express.json());
  app.use('/api', createSimulateRouter(deps));
  return { app, deps };
}

describe('Simulate API', () => {
  it('GET /api/simulate/sell-order returns full message sequence', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/simulate/sell-order?bankAccountId=1');

    expect(res.status).toBe(200);
    expect(res.body.bankAccount).toEqual({
      name: 'Banco Union Personal',
      bank: 'banco-union',
      accountHint: '4521',
    });
    expect(res.body.messages).toHaveLength(3);
    expect(res.body.messages[0]).toMatchObject({ step: 1, type: 'text' });
    expect(res.body.messages[1]).toMatchObject({ step: 2, type: 'image', exists: true });
    expect(res.body.messages[2]).toMatchObject({ step: 3, type: 'text', content: 'Pagar a Banco Union ****4521' });
    expect(res.body.warnings).toEqual([]);
  });

  it('returns 400 when bankAccountId is missing', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/simulate/sell-order');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bankAccountId/);
  });

  it('returns 404 when bank account does not exist', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/simulate/sell-order?bankAccountId=999');
    expect(res.status).toBe(404);
  });

  it('includes warning when account is inactive', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/simulate/sell-order?bankAccountId=2');

    expect(res.status).toBe(200);
    expect(res.body.warnings).toContain('Account is inactive');
  });

  it('accepts custom amount and price params', async () => {
    const deps = createMockDeps();
    // Use account 2 which has no paymentMessage — so fallback includes the amount
    const { app } = buildApp(deps);
    const res = await request(app).get('/api/simulate/sell-order?bankAccountId=2&amount=200&price=7.00');

    expect(res.status).toBe(200);
    const lastMsg = res.body.messages[res.body.messages.length - 1];
    expect(lastMsg.content).toContain('1400.00 BOB');
  });

  it('skips image step when qrCodePath is null', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/simulate/sell-order?bankAccountId=2');

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages.every((m: any) => m.type !== 'image')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/simulate.test.ts`
Expected: FAIL — cannot resolve `../../src/api/routes/simulate.js`

- [ ] **Step 3: Implement the simulate router**

Create `src/api/routes/simulate.ts`:

```typescript
import { Router } from 'express';
import { buildSellOrderMessages } from '../../modules/qr-flow/build-messages.js';

export interface SimulateDeps {
  bankManager: {
    getAccountById: (id: number) => {
      id: number;
      name: string;
      bank: string;
      accountHint: string;
      status: string;
      qrCodePath: string | null;
      paymentMessage: string | null;
    } | undefined;
  };
  qrPreMessage: string;
}

export function createSimulateRouter(deps: SimulateDeps): Router {
  const router = Router();

  router.get('/simulate/sell-order', (req, res) => {
    const bankAccountId = parseInt(req.query.bankAccountId as string, 10);
    if (!bankAccountId || isNaN(bankAccountId)) {
      res.status(400).json({ error: 'Missing required query param: bankAccountId' });
      return;
    }

    const account = deps.bankManager.getAccountById(bankAccountId);
    if (!account) {
      res.status(404).json({ error: 'Bank account not found' });
      return;
    }

    const amount = parseFloat(req.query.amount as string) || 100;
    const price = parseFloat(req.query.price as string) || 6.96;

    const result = buildSellOrderMessages({
      account,
      config: { qrPreMessage: deps.qrPreMessage },
      orderParams: { amount, price },
    });

    // Add account-level warnings
    if (account.status !== 'active') {
      result.warnings.push('Account is inactive');
    }

    res.json({
      bankAccount: {
        name: account.name,
        bank: account.bank,
        accountHint: account.accountHint,
      },
      messages: result.messages,
      warnings: result.warnings,
    });
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/simulate.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/simulate.ts tests/api/simulate.test.ts
git commit -m "feat: add GET /api/simulate/sell-order endpoint"
```

---

### Task 3: Mount Router & Mark Legacy

**Files:**
- Modify: `src/api/index.ts`
- Modify: `src/index.ts:310-349`

- [ ] **Step 1: Mount the simulate router in `src/api/index.ts`**

Add import at the top of `src/api/index.ts` (after the `createBanksRouter` import):

```typescript
import { createSimulateRouter } from './routes/simulate.js';
```

Add mount after the banks router mount (after line 55):

```typescript
  app.use('/api', createSimulateRouter({
    bankManager: deps.bankManager,
    qrPreMessage: deps.qrPreMessage,
  }));
```

Update the `ApiDeps` interface to include `qrPreMessage`:

```typescript
export interface ApiDeps {
  // ... existing fields ...
  qrPreMessage: string;
}
```

- [ ] **Step 2: Pass `qrPreMessage` when creating the API server in `src/index.ts`**

In `src/index.ts`, find the `createApiServer(...)` call and add `qrPreMessage` to the deps object:

```typescript
  qrPreMessage,
```

This uses the existing `qrPreMessage` variable already read at line 93.

- [ ] **Step 3: Add legacy comment to the inline handler in `src/index.ts`**

Replace the comment at line 307:

```typescript
// LEGACY: remove once simulation is validated — use buildSellOrderMessages() instead
// Auto-send QR code on new sell orders
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass, including existing banks and smoke tests.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/api/index.ts src/index.ts
git commit -m "feat: mount simulate router, mark inline QR handler as legacy"
```
