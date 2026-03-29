# Bybit API Integration Tests Design Spec

## Problem

The bot has suffered 6+ bugs caused by mismatches between the Bybit SDK/docs and what the P2P API actually returns:

1. **Type mismatches** — pagination params sent as strings instead of integers, max size 50 instead of 30
2. **SDK pagination broken** — `getP2PPendingOrders()` returns count but no items
3. **Response format divergence** — P2P uses `ret_code`/`ret_msg` (v3), not `retCode`/`retMsg` (v5)
4. **Status 50 ambiguity** — means both "released" and "cancelled"
5. **Side mapping inversion** — `1` = sell from maker perspective, opposite from what's expected
6. **Payment method filtering** — `getP2PUserPayments()` returns `id=0` for "Balance" virtual payment

All existing tests mock the Bybit client, so none of these bugs were catchable before production.

## Solution

A separate vitest integration test suite that makes real HTTP calls against the Bybit **testnet** API. Tests validate response shapes, field types, and semantic correctness — catching the exact class of bugs we've hit.

## Architecture

### Infrastructure

- **Separate vitest config**: `vitest.integration.ts` — includes only `tests/integration/**/*.test.ts`
- **New npm script**: `npm run test:integration` — loads `.env`, runs integration tests only
- **Shared setup**: `tests/integration/setup.ts` — creates a real `BybitClient` with testnet credentials, exports it and a skip guard
- **Timeouts**: 30s default per test, 60s for multi-step sequences

### File Structure

```
tests/integration/
  setup.ts                  # Client setup, env loading, skip guard
  balance.test.ts           # Account balance endpoint
  ad-manager.test.ts        # Ads CRUD + payment methods + online ads
  order-handler.test.ts     # Pending orders, order detail
  chat-relay.test.ts        # Message listing (read-only)
  raw-http.test.ts          # rawPost signing, pagination, response format
```

### setup.ts

- Loads env vars via `dotenv/config`
- Creates `BybitClient(BYBIT_API_KEY, BYBIT_API_SECRET, true)` (testnet = true)
- Exports `client` and `skipIfNoCredentials()` guard
- If credentials are missing, all tests skip with a clear message

## Test Coverage

### balance.test.ts — Smoke test

| Test | Validates |
|------|-----------|
| `getBalance('USDT')` returns valid shape | `coin` is string, `available` and `frozen` are numbers ≥ 0 |

### ad-manager.test.ts — Full ad lifecycle

| Test | Validates |
|------|-----------|
| `getPaymentMethods()` returns valid array | Each entry has `id: number > 0`, `bankName: string`, `accountNo: string` |
| `getPersonalAds()` returns normalized sides | Side is `'buy'` or `'sell'` (not `0`/`1`/`'0'`/`'1'`) |
| `getOnlineAds('buy', ...)` returns market data | Array of ads with parseable numeric prices between 8-12 BOB |
| `getOnlineAds('sell', ...)` returns market data | Same validation, sell side |
| Ad CRUD cycle: create → verify → update → cancel → verify | Created ad appears in personal ads with correct side; update succeeds; cancel removes it |

### order-handler.test.ts — Pending orders + detail

| Test | Validates |
|------|-----------|
| `getPendingOrders()` returns valid array | Response has `ret_code === 0`, items is array, each has numeric status and string orderId |
| Raw response uses v3 format | Fields are `ret_code`/`ret_msg`, not `retCode`/`retMsg` |
| Side mapping in orders is consistent | Side values map to `'buy'`/`'sell'` strings |
| `getOrderDetail(invalidId)` error format | Error response uses same `ret_code`/`ret_msg` format |

### chat-relay.test.ts — Message listing (read-only)

Note: These tests require an active order with messages on testnet. If no orders exist, tests skip gracefully.

| Test | Validates |
|------|-----------|
| `getOrderMessages(orderId)` with valid order | Returns array with `contentType: string`, `sendTime: number`, `fromUserId: string` |
| Pagination params are integers | Request sends `page: 1, size: 30` (not strings) |

### raw-http.test.ts — Signing and raw HTTP layer

| Test | Validates |
|------|-----------|
| `rawPost('/v5/p2p/order/simplifyList', {page: 1, size: 30})` | `ret_code === 0`, signature accepted |
| `rawPost` with invalid endpoint | Returns error with `ret_code !== 0` |
| Integer params survive serialization | `JSON.stringify({page: 1})` produces `1` not `"1"` |

## Design Principles

1. **Read-only where possible.** Most tests only read data. The only mutation is the ad CRUD cycle, which cleans up after itself (create → cancel in same test).

2. **No order mutations.** `markOrderAsPaid()` and `releaseOrder()` are NOT tested against testnet — too dangerous. We validate the read paths where bugs have actually occurred.

3. **Shape over value assertions.** Assert types, field existence, and constraints (`id > 0`, `price` is parseable, `side ∈ {'buy', 'sell'}`). Don't assert specific values since testnet state changes.

4. **Each test is independent.** No shared state between files. Ad CRUD creates and cleans up its own data.

5. **Error format validation.** At least one test triggers an error to verify the response format matches what the normalization helpers expect.

## Out of Scope

- Testing `markOrderAsPaid()` / `releaseOrder()` (unsafe even on testnet)
- Testing Telegram bot commands
- Testing CriptoYa price fetching (separate external API)
- CI integration (manual run only for now)
- Performance benchmarking
