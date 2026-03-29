# QR Auto-Send + Dashboard Upload (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-QR greeting message to the sell-order chat flow, and expose API endpoints to upload/list/delete QR code images for bank accounts.

**Architecture:** One new config key (`qr_pre_message`) controls the greeting. The existing `order:new` handler gains one extra `sendOrderMessage` call before the QR. A new `src/api/routes/banks.ts` route file provides `GET /api/banks`, `PUT /api/banks/:id/qr`, and `DELETE /api/banks/:id/qr`. All follow existing project patterns (Express router, Drizzle ORM, supertest tests).

**Tech Stack:** TypeScript (ESM), Express, Drizzle ORM, better-sqlite3, Vitest, supertest

**Spec:** `docs/superpowers/specs/2026-03-29-qr-auto-send-and-upload-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config.ts` | Modify | Add `qr_pre_message` to `DEFAULT_CONFIG` |
| `src/index.ts` | Modify | Insert pre-QR message send in `order:new` handler |
| `src/api/routes/banks.ts` | Create | `GET /api/banks`, `PUT /:id/qr`, `DELETE /:id/qr` |
| `src/api/index.ts` | Modify | Mount banks router |
| `tests/api/banks.test.ts` | Create | Tests for all three bank endpoints |

---

### Task 1: Add `qr_pre_message` config key

**Files:**
- Modify: `src/config.ts:44-59`

- [ ] **Step 1: Add the new key to DEFAULT_CONFIG**

In `src/config.ts`, add `qr_pre_message` to the `DEFAULT_CONFIG` object (after the last entry `sleep_end_hour`):

```typescript
export const DEFAULT_CONFIG = {
  min_spread: '0.015',
  max_spread: '0.05',
  trade_amount_usdt: '300',
  poll_interval_orders_ms: '5000',
  poll_interval_ads_ms: '30000',
  poll_interval_prices_ms: '30000',
  auto_cancel_timeout_ms: '900000',
  active_sides: 'sell',
  bot_state: 'running',
  volatility_threshold_percent: '2',
  volatility_window_minutes: '5',
  reprice_enabled: 'false',
  sleep_start_hour: '23',
  sleep_end_hour: '10',
  qr_pre_message: 'Hola! En breve te enviaremos el codigo QR para realizar el pago.',
} as const;
```

- [ ] **Step 2: Run typecheck to verify**

Run: `npx tsc --noEmit`
Expected: No errors (ConfigKey type is derived from `keyof typeof DEFAULT_CONFIG`, so it auto-includes the new key).

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add qr_pre_message config key"
```

---

### Task 2: Send pre-QR message in `order:new` handler

**Files:**
- Modify: `src/index.ts:309-340`

- [ ] **Step 1: Add pre-QR message send before QR image**

Replace the `order:new` handler block (lines 309-340) with:

```typescript
bus.on('order:new', async (payload) => {
  if (payload.side !== 'sell') return;

  // Find the bank account used for sell ads
  const activeAds = adManager.getActiveAds();
  const sellAd = activeAds.get('sell');
  if (!sellAd) return;

  if (!sellAd.bankAccountId) return;
  const account = bankManager.getAccountById(sellAd.bankAccountId);
  if (!account) return;

  // Send pre-QR greeting message
  try {
    const preMessage = await getConfig('qr_pre_message');
    await bybitClient.sendOrderMessage(payload.orderId, preMessage);
    log.info({ orderId: payload.orderId }, 'Pre-QR message sent to P2P chat');
  } catch (err) {
    log.error({ err, orderId: payload.orderId }, 'Failed to send pre-QR message');
  }

  // Send QR code image if available
  if (account.qrCodePath) {
    try {
      await bybitClient.sendOrderImage(payload.orderId, account.qrCodePath);
      log.info({ orderId: payload.orderId, bank: account.name }, 'QR code sent to P2P chat');
    } catch (err) {
      log.error({ err, orderId: payload.orderId }, 'Failed to send QR code to P2P chat');
    }
  }

  // Send payment instructions
  const message = account.paymentMessage
    || `Please pay ${(payload.amount * payload.price).toFixed(2)} BOB to ${account.name} (${account.bank}) ****${account.accountHint}`;
  try {
    await bybitClient.sendOrderMessage(payload.orderId, message);
    log.info({ orderId: payload.orderId }, 'Payment instructions sent to P2P chat');
  } catch (err) {
    log.error({ err, orderId: payload.orderId }, 'Failed to send payment instructions');
  }
});
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors. `getConfig('qr_pre_message')` is valid because `ConfigKey` now includes it.

- [ ] **Step 3: Run existing tests to confirm no regression**

Run: `npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: send pre-QR greeting before QR image in sell order chat"
```

---

### Task 3: Write failing tests for banks API

**Files:**
- Create: `tests/api/banks.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/api/banks.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBanksRouter } from '../../src/api/routes/banks.js';

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
    paymentMessage: null,
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
    status: 'active',
    priority: 0,
    qrCodePath: null,
    paymentMessage: null,
  },
];

function createMockDeps() {
  return {
    bankManager: {
      getAccounts: vi.fn(() => mockAccounts),
      getAccountById: vi.fn((id: number) => mockAccounts.find((a) => a.id === id)),
      loadAccounts: vi.fn(async () => {}),
    },
    db: {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => {}),
        })),
      })),
    },
  };
}

function buildApp(deps = createMockDeps()) {
  const app = express();
  app.use(express.json());
  app.use('/api', createBanksRouter(deps as any));
  return { app, deps };
}

describe('Banks API', () => {
  it('GET /api/banks returns all bank accounts', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/banks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Banco Union Personal');
    expect(res.body[1].qrCodePath).toBeNull();
  });

  it('PUT /api/banks/:id/qr returns 404 for unknown bank', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .put('/api/banks/999/qr')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('fake-png-data'));
    expect(res.status).toBe(404);
  });

  it('PUT /api/banks/:id/qr returns 400 for empty body', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .put('/api/banks/1/qr')
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(0));
    expect(res.status).toBe(400);
  });

  it('PUT /api/banks/:id/qr saves file and updates DB', async () => {
    const { app, deps } = buildApp();
    const fakeImage = Buffer.from('fake-png-data');
    const res = await request(app)
      .put('/api/banks/1/qr')
      .set('Content-Type', 'image/png')
      .send(fakeImage);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.qrCodePath).toContain('banco-union-4521');
    expect(deps.bankManager.loadAccounts).toHaveBeenCalled();
  });

  it('DELETE /api/banks/:id/qr returns 404 for unknown bank', async () => {
    const { app } = buildApp();
    const res = await request(app).delete('/api/banks/999/qr');
    expect(res.status).toBe(404);
  });

  it('DELETE /api/banks/:id/qr clears qrCodePath and reloads', async () => {
    const { app, deps } = buildApp();
    const res = await request(app).delete('/api/banks/1/qr');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deps.bankManager.loadAccounts).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/api/banks.test.ts`
Expected: FAIL — `Cannot find module '../../src/api/routes/banks.js'`

- [ ] **Step 3: Commit**

```bash
git add tests/api/banks.test.ts
git commit -m "test: add failing tests for banks API endpoints"
```

---

### Task 4: Implement banks API route

**Files:**
- Create: `src/api/routes/banks.ts`

- [ ] **Step 1: Create the banks route file**

Create `src/api/routes/banks.ts`:

```typescript
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { bankAccounts } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('api-banks');

const QR_DIR = './data/qr';

export interface BanksDeps {
  bankManager: {
    getAccountById: (id: number) => { id: number; name: string; bank: string; accountHint: string; qrCodePath: string | null } | undefined;
    getAccounts: () => Array<{
      id: number;
      name: string;
      bank: string;
      accountHint: string;
      balanceBob: number;
      dailyVolume: number;
      dailyLimit: number;
      monthlyVolume: number;
      status: string;
      priority: number;
      qrCodePath: string | null;
      paymentMessage: string | null;
    }>;
    loadAccounts: () => Promise<void>;
  };
  db: DB;
}

export function createBanksRouter(deps: BanksDeps): Router {
  const router = Router();

  // List all bank accounts
  router.get('/banks', (_req, res) => {
    const accounts = deps.bankManager.getAccounts();
    res.json(accounts);
  });

  // Upload QR code image for a bank account
  router.put('/banks/:id/qr', async (req, res) => {
    const accountId = parseInt(req.params.id, 10);
    const account = deps.bankManager.getAccountById(accountId);
    if (!account) {
      res.status(404).json({ error: 'Bank account not found' });
      return;
    }

    try {
      // Read raw body as buffer
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length === 0) {
        res.status(400).json({ error: 'No image data' });
        return;
      }

      // Save file
      mkdirSync(QR_DIR, { recursive: true });
      const ext = (req.headers['content-type'] ?? '').includes('png') ? 'png' : 'jpg';
      const filename = `${account.bank}-${account.accountHint}.${ext}`;
      const filePath = join(QR_DIR, filename);
      writeFileSync(filePath, buffer);

      // Update DB
      await deps.db
        .update(bankAccounts)
        .set({ qrCodePath: filePath })
        .where(eq(bankAccounts.id, accountId));

      // Reload in-memory cache
      await deps.bankManager.loadAccounts();

      log.info({ accountId, filePath }, 'QR code uploaded');
      res.json({ success: true, qrCodePath: filePath });
    } catch (err) {
      log.error({ err, accountId }, 'Failed to upload QR code');
      res.status(500).json({ error: 'Failed to upload QR code' });
    }
  });

  // Delete QR code for a bank account
  router.delete('/banks/:id/qr', async (req, res) => {
    const accountId = parseInt(req.params.id, 10);
    const account = deps.bankManager.getAccountById(accountId);
    if (!account) {
      res.status(404).json({ error: 'Bank account not found' });
      return;
    }

    try {
      // Delete file from disk if it exists
      if (account.qrCodePath && existsSync(account.qrCodePath)) {
        unlinkSync(account.qrCodePath);
      }

      // Clear in DB
      await deps.db
        .update(bankAccounts)
        .set({ qrCodePath: null })
        .where(eq(bankAccounts.id, accountId));

      // Reload in-memory cache
      await deps.bankManager.loadAccounts();

      log.info({ accountId }, 'QR code deleted');
      res.json({ success: true });
    } catch (err) {
      log.error({ err, accountId }, 'Failed to delete QR code');
      res.status(500).json({ error: 'Failed to delete QR code' });
    }
  });

  return router;
}
```

- [ ] **Step 2: Run the banks tests**

Run: `npx vitest run tests/api/banks.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/api/routes/banks.ts
git commit -m "feat: add banks API route (GET list, PUT/DELETE QR)"
```

---

### Task 5: Mount banks router in API server

**Files:**
- Modify: `src/api/index.ts`

- [ ] **Step 1: Add import and mount the router**

In `src/api/index.ts`, add the import at the top (after the `createPricesRouter` import, line 11):

```typescript
import { createBanksRouter } from './routes/banks.js';
```

Then mount it after the existing routes (after line 53 `app.use('/api', createPricesRouter(...))`):

```typescript
  app.use('/api', createBanksRouter({ bankManager: deps.bankManager, db: deps.db }));
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/api/index.ts
git commit -m "feat: mount banks API router in server"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean, no errors.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Verify the three API endpoints work with curl (manual)**

```bash
# Start the bot in dev mode
npm run dev

# List banks
curl http://localhost:3000/api/banks | jq .

# Upload a test QR (use any PNG you have)
curl -X PUT http://localhost:3000/api/banks/1/qr \
  -H "Content-Type: image/png" \
  --data-binary @./data/qr/some-test-image.png

# Delete QR
curl -X DELETE http://localhost:3000/api/banks/1/qr
```
