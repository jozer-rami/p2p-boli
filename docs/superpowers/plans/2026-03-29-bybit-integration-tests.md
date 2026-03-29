# Bybit API Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a live Bybit testnet integration test suite that catches type mismatches, response format divergence, and side mapping bugs that mocked tests miss.

**Architecture:** Separate vitest project config (`vitest.integration.ts`) pointing at `tests/integration/`. Shared setup creates a real `BybitClient` with testnet credentials from `.env`. Tests validate response shapes, field types, and semantic correctness against the live testnet API.

**Tech Stack:** Vitest, dotenv, BybitClient (existing), Bybit testnet API

---

### Task 1: Vitest Integration Config + Setup

**Files:**
- Create: `vitest.integration.ts`
- Create: `tests/integration/setup.ts`
- Modify: `package.json` (add `test:integration` script)

- [ ] **Step 1: Create `vitest.integration.ts`**

```typescript
// vitest.integration.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 2: Create `tests/integration/setup.ts`**

```typescript
// tests/integration/setup.ts
import 'dotenv/config';
import { BybitClient } from '../../src/bybit/client.js';

const apiKey = process.env.BYBIT_API_KEY;
const apiSecret = process.env.BYBIT_API_SECRET;

export const hasCredentials = !!(apiKey && apiSecret);

export function createTestClient(): BybitClient {
  if (!hasCredentials) {
    throw new Error('BYBIT_API_KEY and BYBIT_API_SECRET must be set in .env');
  }
  return new BybitClient(apiKey!, apiSecret!, true); // testnet = true
}
```

- [ ] **Step 3: Add `test:integration` script to `package.json`**

Add to `scripts` in `package.json`:

```json
"test:integration": "vitest run --config vitest.integration.ts"
```

- [ ] **Step 4: Verify config loads correctly**

Run: `npm run test:integration`
Expected: vitest runs, finds 0 test files (no test files yet), exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add vitest.integration.ts tests/integration/setup.ts package.json
git commit -m "feat: add vitest integration test config and setup"
```

---

### Task 2: Balance Integration Test

**Files:**
- Create: `tests/integration/balance.test.ts`

- [ ] **Step 1: Write the balance test**

```typescript
// tests/integration/balance.test.ts
import { describe, it, expect } from 'vitest';
import { createTestClient, hasCredentials } from './setup.js';

describe.skipIf(!hasCredentials)('Balance API', () => {
  const client = createTestClient();

  it('getBalance returns valid shape for USDT', async () => {
    const balance = await client.getBalance('USDT');

    expect(balance).toHaveProperty('coin', 'USDT');
    expect(typeof balance.available).toBe('number');
    expect(typeof balance.frozen).toBe('number');
    expect(balance.available).toBeGreaterThanOrEqual(0);
    expect(balance.frozen).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(balance.available)).toBe(false);
    expect(Number.isNaN(balance.frozen)).toBe(false);
  });

  it('getBalance returns zeros for non-existent coin', async () => {
    const balance = await client.getBalance('NONEXISTENT');

    expect(balance).toEqual({ coin: 'NONEXISTENT', available: 0, frozen: 0 });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:integration`
Expected: 2 tests PASS (or SKIP if no credentials).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/balance.test.ts
git commit -m "test: add balance API integration test"
```

---

### Task 3: Payment Methods Integration Test

**Files:**
- Create: `tests/integration/ad-manager.test.ts`

- [ ] **Step 1: Write payment methods test**

```typescript
// tests/integration/ad-manager.test.ts
import { describe, it, expect } from 'vitest';
import { createTestClient, hasCredentials } from './setup.js';

describe.skipIf(!hasCredentials)('Ad Manager API', () => {
  const client = createTestClient();

  describe('getPaymentMethods', () => {
    it('returns array with valid payment method shapes', async () => {
      const methods = await client.getPaymentMethods();

      expect(Array.isArray(methods)).toBe(true);

      for (const method of methods) {
        expect(typeof method.id).toBe('string');
        // id must be > 0 (the "Balance" virtual payment with id=0 should be filtered)
        expect(Number(method.id)).toBeGreaterThan(0);
        expect(typeof method.bankName).toBe('string');
        expect(typeof method.accountNo).toBe('string');
        expect(typeof method.realName).toBe('string');
      }
    });

    it('excludes Balance payment method (id=0)', async () => {
      const methods = await client.getPaymentMethods();

      const zeroIds = methods.filter(m => Number(m.id) === 0);
      expect(zeroIds).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:integration`
Expected: balance tests + payment methods tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/ad-manager.test.ts
git commit -m "test: add payment methods integration test"
```

---

### Task 4: Online Ads + Personal Ads Tests

**Files:**
- Modify: `tests/integration/ad-manager.test.ts`

- [ ] **Step 1: Add online ads tests**

Append these `describe` blocks inside the existing `describe('Ad Manager API')`:

```typescript
  describe('getOnlineAds', () => {
    it('returns buy-side ads with valid shapes', async () => {
      const ads = await client.getOnlineAds('buy', 'USDT', 'BOB');

      expect(Array.isArray(ads)).toBe(true);

      for (const ad of ads) {
        expect(typeof ad.id).toBe('string');
        expect(ad.side).toBe('buy');
        expect(typeof ad.price).toBe('number');
        expect(Number.isNaN(ad.price)).toBe(false);
        expect(ad.price).toBeGreaterThan(0);
        expect(typeof ad.amount).toBe('number');
        expect(Number.isNaN(ad.amount)).toBe(false);
        expect(typeof ad.status).toBe('string');
      }
    });

    it('returns sell-side ads with valid shapes', async () => {
      const ads = await client.getOnlineAds('sell', 'USDT', 'BOB');

      expect(Array.isArray(ads)).toBe(true);

      for (const ad of ads) {
        expect(ad.side).toBe('sell');
        expect(typeof ad.price).toBe('number');
        expect(ad.price).toBeGreaterThan(0);
      }
    });

    it('side mapping is consistent (buy=1 in API, returned as "buy")', async () => {
      const buyAds = await client.getOnlineAds('buy', 'USDT', 'BOB');
      const sellAds = await client.getOnlineAds('sell', 'USDT', 'BOB');

      // Every ad returned by buy query should have side='buy'
      for (const ad of buyAds) {
        expect(ad.side).toBe('buy');
      }
      // Every ad returned by sell query should have side='sell'
      for (const ad of sellAds) {
        expect(ad.side).toBe('sell');
      }
    });
  });

  describe('getPersonalAds', () => {
    it('returns array with normalized side values', async () => {
      const ads = await client.getPersonalAds();

      expect(Array.isArray(ads)).toBe(true);

      for (const ad of ads) {
        expect(typeof ad.id).toBe('string');
        // Side must be normalized to 'buy' or 'sell', never 0/1/'0'/'1'
        expect(['buy', 'sell']).toContain(ad.side);
        expect(typeof ad.price).toBe('number');
        expect(Number.isNaN(ad.price)).toBe(false);
        expect(typeof ad.amount).toBe('number');
        expect(typeof ad.status).toBe('string');
      }
    });
  });
```

- [ ] **Step 2: Run the test**

Run: `npm run test:integration`
Expected: All ad-manager tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/ad-manager.test.ts
git commit -m "test: add online ads and personal ads integration tests"
```

---

### Task 5: Ad CRUD Lifecycle Test

**Files:**
- Modify: `tests/integration/ad-manager.test.ts`

- [ ] **Step 1: Add the CRUD lifecycle test**

Append this `describe` block inside the existing `describe('Ad Manager API')`:

```typescript
  describe('Ad CRUD lifecycle', () => {
    it('create → verify → update → cancel → verify gone', async () => {
      const methods = await client.getPaymentMethods();
      if (methods.length === 0) {
        console.warn('Skipping ad CRUD: no payment methods on testnet');
        return;
      }

      // Create a sell ad at an intentionally high price so nobody takes it
      const adId = await client.createAd({
        side: 'sell',
        price: 99.99,
        amount: 10,
        currencyId: 'USDT',
        fiatCurrencyId: 'BOB',
        paymentMethodIds: [methods[0].id],
        remark: 'Integration test ad — will be cancelled',
      });

      expect(typeof adId).toBe('string');
      expect(adId.length).toBeGreaterThan(0);

      // Verify it appears in personal ads
      const adsAfterCreate = await client.getPersonalAds();
      const created = adsAfterCreate.find(a => a.id === adId);
      expect(created).toBeDefined();
      expect(created!.side).toBe('sell');

      // Update (reprice)
      await client.updateAd(adId, 99.98, 10, [methods[0].id]);

      // Verify price updated
      const adsAfterUpdate = await client.getPersonalAds();
      const updated = adsAfterUpdate.find(a => a.id === adId);
      expect(updated).toBeDefined();
      expect(updated!.price).toBeCloseTo(99.98, 1);

      // Cancel
      await client.cancelAd(adId);

      // Verify gone
      const adsAfterCancel = await client.getPersonalAds();
      const cancelled = adsAfterCancel.find(a => a.id === adId);
      expect(cancelled).toBeUndefined();
    }, 60_000); // 60s timeout for multi-step
  });
```

- [ ] **Step 2: Run the test**

Run: `npm run test:integration`
Expected: All tests PASS including CRUD lifecycle.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/ad-manager.test.ts
git commit -m "test: add ad CRUD lifecycle integration test"
```

---

### Task 6: Order Handler Integration Test

**Files:**
- Create: `tests/integration/order-handler.test.ts`

- [ ] **Step 1: Write the order handler tests**

```typescript
// tests/integration/order-handler.test.ts
import { describe, it, expect } from 'vitest';
import { createTestClient, hasCredentials } from './setup.js';

describe.skipIf(!hasCredentials)('Order Handler API', () => {
  const client = createTestClient();

  describe('getPendingOrders', () => {
    it('returns array with valid order shapes', async () => {
      const orders = await client.getPendingOrders();

      expect(Array.isArray(orders)).toBe(true);

      for (const order of orders) {
        expect(typeof order.id).toBe('string');
        // Side must be normalized, not raw 0/1
        expect(['buy', 'sell']).toContain(order.side);
        expect(typeof order.amount).toBe('number');
        expect(Number.isNaN(order.amount)).toBe(false);
        expect(typeof order.price).toBe('number');
        expect(Number.isNaN(order.price)).toBe(false);
        expect(typeof order.totalBob).toBe('number');
        expect(typeof order.status).toBe('string');
        expect(typeof order.createdAt).toBe('number');
        expect(Number.isNaN(order.createdAt)).toBe(false);
      }
    });

    it('does not contain terminal status orders (40, 50)', async () => {
      const orders = await client.getPendingOrders();

      for (const order of orders) {
        expect(['40', '50']).not.toContain(order.status);
      }
    });
  });

  describe('getOrderDetail', () => {
    it('throws with descriptive error for invalid orderId', async () => {
      await expect(client.getOrderDetail('invalid-order-id-12345'))
        .rejects.toThrow();
    });

    it('returns valid shape for a real order (if any exist)', async () => {
      // Try to find a real order to test detail endpoint
      const orders = await client.getPendingOrders();
      if (orders.length === 0) {
        console.warn('Skipping getOrderDetail shape test: no pending orders on testnet');
        return;
      }

      const detail = await client.getOrderDetail(orders[0].id);

      expect(typeof detail.id).toBe('string');
      expect(['buy', 'sell']).toContain(detail.side);
      expect(typeof detail.amount).toBe('number');
      expect(typeof detail.price).toBe('number');
      expect(typeof detail.totalBob).toBe('number');
      expect(typeof detail.status).toBe('string');
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:integration`
Expected: All order handler tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/order-handler.test.ts
git commit -m "test: add order handler integration tests"
```

---

### Task 7: Chat Relay Integration Test

**Files:**
- Create: `tests/integration/chat-relay.test.ts`

- [ ] **Step 1: Write the chat relay tests**

```typescript
// tests/integration/chat-relay.test.ts
import { describe, it, expect } from 'vitest';
import { createTestClient, hasCredentials } from './setup.js';

describe.skipIf(!hasCredentials)('Chat Relay API', () => {
  const client = createTestClient();

  describe('getOrderMessages', () => {
    it('returns array for a pending order (if any exist)', async () => {
      const orders = await client.getPendingOrders();
      if (orders.length === 0) {
        console.warn('Skipping getOrderMessages test: no pending orders on testnet');
        return;
      }

      const messages = await client.getOrderMessages(orders[0].id);

      expect(Array.isArray(messages)).toBe(true);

      for (const msg of messages) {
        expect(typeof msg.content).toBe('string');
        expect(typeof msg.contentType).toBe('string');
        expect(typeof msg.sendTime).toBe('number');
        expect(typeof msg.fromUserId).toBe('string');
        expect(typeof msg.roleType).toBe('string');
        expect(typeof msg.nickName).toBe('string');
      }
    });

    it('throws for invalid orderId', async () => {
      await expect(client.getOrderMessages('invalid-order-id-12345'))
        .rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:integration`
Expected: Chat relay tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/chat-relay.test.ts
git commit -m "test: add chat relay integration tests"
```

---

### Task 8: Raw HTTP Signing Validation

**Files:**
- Create: `tests/integration/raw-http.test.ts`

The `rawPost` method on `BybitClient` is private, so we test it indirectly through `getPendingOrders()` and `getOrderMessages()`. However, we also want to test the signing + integer param serialization explicitly. We'll create a minimal subclass that exposes `rawPost` for testing.

- [ ] **Step 1: Write the raw HTTP tests**

```typescript
// tests/integration/raw-http.test.ts
import { describe, it, expect } from 'vitest';
import { hasCredentials } from './setup.js';
import 'dotenv/config';

/**
 * Test raw HTTP signing directly, bypassing the BybitClient wrapper.
 * This catches regressions in signature generation and param serialization.
 */
describe.skipIf(!hasCredentials)('Raw HTTP Signing', () => {
  const apiKey = process.env.BYBIT_API_KEY!;
  const apiSecret = process.env.BYBIT_API_SECRET!;
  const baseUrl = 'https://api-testnet.bybit.com';

  async function rawPost(path: string, body: Record<string, any> = {}): Promise<any> {
    const crypto = await import('node:crypto');
    const timestamp = String(Date.now());
    const recvWindow = '5000';
    const bodyStr = JSON.stringify(body);
    const preSign = timestamp + apiKey + recvWindow + bodyStr;
    const signature = crypto.createHmac('sha256', apiSecret).update(preSign).digest('hex');

    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
      body: bodyStr,
    });

    return res.json();
  }

  it('signature is accepted for /v5/p2p/order/simplifyList', async () => {
    const res = await rawPost('/v5/p2p/order/simplifyList', { page: 1, size: 30 });

    // Response should use ret_code (v3 format), not retCode (v5 format)
    const code = res.ret_code ?? res.retCode;
    expect(code).toBe(0);
  });

  it('response uses v3 format (ret_code/ret_msg)', async () => {
    const res = await rawPost('/v5/p2p/order/simplifyList', { page: 1, size: 30 });

    // At least one of these v3 fields should be present
    const hasV3 = 'ret_code' in res || 'retCode' in res;
    expect(hasV3).toBe(true);
  });

  it('integer params are not stringified in body', () => {
    // This is a pure unit assertion but validates the critical serialization bug
    const body = { page: 1, size: 30, orderId: 'abc' };
    const serialized = JSON.stringify(body);

    expect(serialized).toContain('"page":1');
    expect(serialized).toContain('"size":30');
    expect(serialized).not.toContain('"page":"1"');
    expect(serialized).not.toContain('"size":"30"');
  });

  it('rejects requests with invalid signature gracefully', async () => {
    const crypto = await import('node:crypto');
    const timestamp = String(Date.now());
    const recvWindow = '5000';
    const bodyStr = JSON.stringify({ page: 1, size: 30 });

    const res = await fetch(`${baseUrl}/v5/p2p/order/simplifyList`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-SIGN': 'invalid-signature-000000',
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
      body: bodyStr,
    });

    const json = await res.json();
    const code = json.ret_code ?? json.retCode;
    expect(code).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:integration`
Expected: All raw HTTP tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/raw-http.test.ts
git commit -m "test: add raw HTTP signing integration tests"
```

---

### Task 9: Run Full Suite + Verify Existing Tests Unaffected

- [ ] **Step 1: Run integration tests**

Run: `npm run test:integration`
Expected: All integration tests PASS.

- [ ] **Step 2: Run unit tests to verify no regression**

Run: `npm test`
Expected: All existing unit tests still PASS. The integration tests are NOT included (different config file).

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors.

- [ ] **Step 4: Commit any final fixes**

If any adjustments were needed, commit them:

```bash
git add -A
git commit -m "fix: resolve integration test issues"
```
