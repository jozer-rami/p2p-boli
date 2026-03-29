# Bank Account CRUD — Dashboard Management

**Date:** 2026-03-29
**Scope:** Backend API + Dashboard UI. Extends the existing banks API and BankQrManager component.

## Problem

Bank accounts are currently created via the seed script (`src/scripts/seed-banks.ts`). There's no way to add, edit, or deactivate bank accounts from the dashboard.

## Changes

### 1. New API Endpoint: `POST /api/banks`

**File:** `src/api/routes/banks.ts`

**Purpose:** Create a new bank account.

**Request:**
- Method: `POST`
- Path: `/api/banks`
- Content-Type: `application/json`
- Required body: `{ name: string, bank: string, accountHint: string, balanceBob: number, dailyLimit: number }`
- Optional body: `{ priority?: number, paymentMessage?: string }`

**Behavior:**
1. Validate required fields are present and non-empty
2. Insert into `bank_accounts` table with defaults: `status: 'active'`, `priority: 0`, `dailyVolume: 0`, `monthlyVolume: 0`
3. Reload BankManager in-memory cache
4. Return `{ success: true, id: <newId> }`

**Error cases:**
- 400 if required fields are missing or invalid
- 500 on DB failure

### 2. New API Endpoint: `PATCH /api/banks/:id`

**File:** `src/api/routes/banks.ts`

**Purpose:** Update one or more fields of an existing bank account.

**Request:**
- Method: `PATCH`
- Path: `/api/banks/:id`
- Content-Type: `application/json`
- Body: any subset of `{ name, bank, accountHint, balanceBob, dailyLimit, priority, paymentMessage, status }`

**Behavior:**
1. Validate bank account exists (404 if not)
2. Filter body to only allowed fields
3. Update only the provided fields in DB
4. Reload BankManager in-memory cache
5. Return `{ success: true }`

**Error cases:**
- 404 if bank account not found
- 400 if body is empty or has no valid fields
- 500 on DB failure

### 3. Dashboard — Extend BankQrManager Component

**File:** `dashboard/src/components/BankQrManager.tsx`

**Editable bank rows:** When a bank row is expanded, show the QR section (existing) followed by editable fields:
- Name (text input)
- Bank slug (text input)
- Account hint (text input)
- Balance BOB (number input)
- Daily limit (number input)
- Priority (number input)
- Payment message (text input)
- Status toggle (active/inactive) — at the top of the expanded area

A "Save" button at the bottom commits changes via `PATCH /api/banks/:id`. Button is disabled until a field is modified.

**Add account form:** Below the bank list, a `+ Add account` text button. Clicking it expands an inline form with: name, bank slug, account hint, balance, daily limit. A "Create" button calls `POST /api/banks`. Form collapses and list refreshes on success.

**Inactive accounts:** Rendered with reduced opacity (`opacity-50`) and an "INACTIVE" label next to the name. Still expandable for editing and re-activation via the status toggle.

### 4. Dashboard — New API Hooks

**File:** `dashboard/src/hooks/useApi.ts`

- `useCreateBank()` — mutation calling `POST /api/banks`, invalidates `['banks']`
- `useUpdateBank()` — mutation calling `PATCH /api/banks/:id`, invalidates `['banks']`

## Files Changed

| File | Change |
|------|--------|
| `src/api/routes/banks.ts` | Add `POST /api/banks` and `PATCH /api/banks/:id` endpoints |
| `dashboard/src/hooks/useApi.ts` | Add `useCreateBank` and `useUpdateBank` hooks |
| `dashboard/src/components/BankQrManager.tsx` | Add inline edit fields, add-account form, status toggle, inactive styling |
| `tests/api/banks.test.ts` | Add tests for POST and PATCH endpoints |

## Not in Scope

- Hard delete of bank accounts (deactivation only)
- Editing bank accounts from Telegram (existing balance commands remain)
- Validation of bank slug against a known list
