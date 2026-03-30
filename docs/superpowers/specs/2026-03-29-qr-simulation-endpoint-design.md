# QR Simulation Endpoint — Design Spec

## Goal

Create a dry-run API endpoint that returns the exact message sequence the bot would send to a Bybit P2P chat on a new sell order, without calling any external APIs. This lets us validate the QR auto-send flow from the dashboard before going to prod.

## Approach: Extract + Shared Function

Extract the QR send logic from `src/index.ts` (lines 310-349) into a pure function. Both the simulation endpoint and (eventually) the production handler call this same function. The old inline handler in `index.ts` is marked as legacy and kept running until the simulation is validated.

## New Files

### `src/modules/qr-flow/build-messages.ts`

Pure function — no side effects, no Bybit calls, no DB writes.

```typescript
interface MessageStep =
  | { step: number; type: 'text'; content: string }
  | { step: number; type: 'image'; path: string; exists: boolean }

interface BuildMessagesInput {
  account: {
    name: string;
    bank: string;
    accountHint: string;
    qrCodePath: string | null;
    paymentMessage: string | null;
  };
  config: { qrPreMessage: string };
  orderParams?: { amount: number; price: number };
}

function buildSellOrderMessages(input: BuildMessagesInput): MessageStep[]
```

**Logic:**
1. Always push step 1: `{ type: 'text', content: config.qrPreMessage }`
2. If `account.qrCodePath` is set, push step 2: `{ type: 'image', path: qrCodePath, exists: <fs check> }`
3. Push final step: `{ type: 'text', content: account.paymentMessage || generated fallback }`

The fallback payment message: `"Please pay {amount * price} BOB to {name} ({bank}) ****{accountHint}"`

When `orderParams` is omitted, the fallback uses placeholder values (amount=100, price=6.96).

### `src/api/routes/simulate.ts`

**Endpoint:** `GET /api/simulate/sell-order`

**Query params:**
| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `bankAccountId` | yes | — | Bank account to simulate |
| `amount` | no | `100` | USDT amount |
| `price` | no | `6.96` | BOB/USDT price |

**Response (200):**
```json
{
  "bankAccount": { "name": "Banco Union", "bank": "banco-union", "accountHint": "4521" },
  "messages": [
    { "step": 1, "type": "text", "content": "Hola! En breve te enviaremos el codigo QR para realizar el pago." },
    { "step": 2, "type": "image", "path": "./data/qr/banco-union-4521.png", "exists": true },
    { "step": 3, "type": "text", "content": "Please pay 696.00 BOB to Banco Union (banco-union) ****4521" }
  ],
  "warnings": []
}
```

**Warnings** (non-fatal issues surfaced in the `warnings` array):
- `"QR file not found on disk"` — qrCodePath is set but file doesn't exist
- `"Account is inactive"` — account status is not "active"
- `"No custom payment message — using generated fallback"` — paymentMessage is null

**Error responses:**
- `400` — missing `bankAccountId`
- `404` — bank account not found

**Dependencies:** `bankManager` (read accounts), config store (read `qr_pre_message`). No Bybit client, no event bus.

### Legacy Marker in `src/index.ts`

The existing inline handler (lines 310-349) gets a comment:
```typescript
// LEGACY: remove once simulation is validated — use buildSellOrderMessages() instead
```
No functional changes to the production flow.

## Testing

### `tests/modules/qr-flow/build-messages.test.ts`

Unit tests for the pure function:
- Returns 3 steps (text, image, text) when account has QR + payment message
- Skips image step when `qrCodePath` is null
- Uses fallback payment message when `paymentMessage` is null
- Marks `exists: false` when QR file path set but file missing on disk
- Generates correct BOB amount from `amount * price`

### `tests/api/simulate.test.ts`

Endpoint tests (supertest + mock deps):
- 200 with valid bankAccountId — returns full message sequence
- 400 when bankAccountId query param missing
- 404 when bank account doesn't exist
- Includes warning when account is inactive
- Includes warning when QR file path set but file missing

## Out of Scope

- No frontend/dashboard changes (API-only)
- No changes to the production send flow (legacy handler untouched)
- No live-fire mode (no actual Bybit API calls)
- Migrating the prod handler to use `buildSellOrderMessages()` happens in a follow-up after validation
