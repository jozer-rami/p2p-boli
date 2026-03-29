# QR Auto-Send + Dashboard Upload (Backend)

**Date:** 2026-03-29
**Scope:** Backend only (API + bot logic). Dashboard UI deferred to a follow-up.

## Problem

QR codes for bank accounts are currently configured via the seed script (`src/scripts/seed-banks.ts`). There's no way to upload or change them from the dashboard. Additionally, the current auto-send flow sends the QR immediately without a friendly intro message for the buyer.

## Changes

### 1. New Config Key: `qr_pre_message`

Add to `DEFAULT_CONFIG` in `src/config.ts`:

| Key | Default | Purpose |
|-----|---------|---------|
| `qr_pre_message` | `"Hola! En breve te enviaremos el codigo QR para realizar el pago."` | Spanish message sent to buyer before the QR image |

Type: `string` in the `config` table, same pattern as all other config keys.

### 2. Modified `order:new` Handler

**File:** `src/index.ts` (lines 309-340)

Current flow:
```
order:new (sell) -> send QR image -> send payment message
```

New flow:
```
order:new (sell) -> send pre-QR message -> send QR image -> send payment message
```

Implementation:
1. Read `qr_pre_message` from config (via existing `getConfig()`)
2. Call `bybitClient.sendOrderMessage(orderId, preMessage)` before the QR
3. Then send QR image (existing code)
4. Then send payment instructions (existing code)

All three calls are sequential — each must complete before the next. Existing try/catch error handling per call remains the same. If the pre-message fails, still attempt to send QR + payment message (non-blocking).

### 3. New API Endpoint: `PUT /api/banks/:id/qr`

**File:** New route file `src/api/routes/banks.ts`

**Purpose:** Upload a QR code image for a bank account.

**Request:**
- Method: `PUT`
- Path: `/api/banks/:id/qr`
- Content-Type: `multipart/form-data` or raw binary (match existing pattern from `POST /orders/:id/chat/image`)
- Body: Raw image bytes

**Behavior:**
1. Validate bank account exists (via `bankManager.getAccountById(id)`)
2. Ensure `/data/qr/` directory exists (`mkdirSync` with `recursive: true`)
3. Save image to `/data/qr/{bank}-{accountHint}.png` (overwrite if exists)
4. Update `qrCodePath` in DB: `UPDATE bank_accounts SET qr_code_path = ? WHERE id = ?`
5. Reload BankManager in-memory cache (`bankManager.loadAccounts()`)
6. Return `{ success: true, qrCodePath: "<path>" }`

**Error cases:**
- 404 if bank account ID not found
- 400 if no image data in body
- 500 on file write or DB failure

**Dependencies interface:**
```typescript
export interface BanksDeps {
  bankManager: {
    getAccountById: (id: number) => BankAccountRecord | undefined;
    getAccounts: () => BankAccountRecord[];
    loadAccounts: () => Promise<void>;
  };
  db: DB;
}
```

**Wire in:** `src/api/index.ts` — mount alongside existing routes:
```typescript
app.use('/api', createBanksRouter({ bankManager: deps.bankManager, db: deps.db }));
```

### 4. New API Endpoint: `GET /api/banks`

**File:** Same `src/api/routes/banks.ts`

**Purpose:** List all bank accounts (needed by dashboard to show which banks have QR codes).

**Response:** Array of bank account records (id, name, bank, accountHint, status, qrCodePath, paymentMessage).

### 5. New API Endpoint: `DELETE /api/banks/:id/qr`

**File:** Same `src/api/routes/banks.ts`

**Purpose:** Remove QR code for a bank account.

**Behavior:**
1. Validate bank account exists
2. Delete file from disk if it exists
3. Set `qrCodePath = null` in DB
4. Reload BankManager cache
5. Return `{ success: true }`

## Files Changed

| File | Change |
|------|--------|
| `src/config.ts` | Add `qr_pre_message` to `DEFAULT_CONFIG` |
| `src/index.ts` | Add pre-QR message send before QR in `order:new` handler |
| `src/api/routes/banks.ts` | **New file** — `GET /api/banks`, `PUT /api/banks/:id/qr`, `DELETE /api/banks/:id/qr` |
| `src/api/index.ts` | Mount new banks router |

## Not in Scope

- Dashboard UI for QR upload (follow-up)
- Multiple QR codes per bank account
- QR code generation (images are uploaded manually)
- Delay between pre-message and QR send
