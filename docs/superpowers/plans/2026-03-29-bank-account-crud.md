# Bank Account CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add create and update bank account endpoints, and extend the dashboard to manage bank accounts inline (add, edit fields, toggle active/inactive).

**Architecture:** Two new endpoints (`POST /api/banks`, `PATCH /api/banks/:id`) added to the existing banks router. Two new React Query mutation hooks. The existing `BankQrManager` component is extended with an editable form in the expanded row and an "Add account" form at the bottom.

**Tech Stack:** TypeScript (ESM), Express, Drizzle ORM, better-sqlite3, Vitest, supertest, React 19, React Query, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-29-bank-account-crud-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/api/routes/banks.ts` | Modify | Add `POST /api/banks` and `PATCH /api/banks/:id` |
| `tests/api/banks.test.ts` | Modify | Add tests for POST and PATCH |
| `dashboard/src/hooks/useApi.ts` | Modify | Add `useCreateBank` and `useUpdateBank` hooks |
| `dashboard/src/components/BankQrManager.tsx` | Modify | Add inline edit form, add-account form, status toggle, inactive styling |

---

### Task 1: Add tests for POST /api/banks

**Files:**
- Modify: `tests/api/banks.test.ts`

- [ ] **Step 1: Add mock for db.insert to createMockDeps**

In `tests/api/banks.test.ts`, update the `createMockDeps` function to add an `insert` mock alongside the existing `update` mock:

```typescript
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
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: 3 }]),
        })),
      })),
    },
  };
}
```

- [ ] **Step 2: Add POST tests**

Add these tests inside the existing `describe('Banks API', ...)` block, after the DELETE test:

```typescript
  it('POST /api/banks creates a new bank account', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .post('/api/banks')
      .send({
        name: 'Banco Sol',
        bank: 'banco-sol',
        accountHint: '1234',
        balanceBob: 5000,
        dailyLimit: 20000,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(3);
    expect(deps.db.insert).toHaveBeenCalled();
    expect(deps.bankManager.loadAccounts).toHaveBeenCalled();
  });

  it('POST /api/banks returns 400 for missing required fields', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/banks')
      .send({ name: 'Incomplete' });
    expect(res.status).toBe(400);
  });

  it('POST /api/banks accepts optional priority and paymentMessage', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .post('/api/banks')
      .send({
        name: 'Banco Sol',
        bank: 'banco-sol',
        accountHint: '1234',
        balanceBob: 5000,
        dailyLimit: 20000,
        priority: 5,
        paymentMessage: 'Pay here',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deps.db.insert).toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/api/banks.test.ts`
Expected: FAIL — `POST /api/banks` returns 404 (no route handler yet)

- [ ] **Step 4: Commit**

```bash
git add tests/api/banks.test.ts
git commit -m "test: add failing tests for POST /api/banks"
```

---

### Task 2: Add tests for PATCH /api/banks/:id

**Files:**
- Modify: `tests/api/banks.test.ts`

- [ ] **Step 1: Add PATCH tests**

Add these tests inside the `describe('Banks API', ...)` block, after the POST tests:

```typescript
  it('PATCH /api/banks/:id updates bank fields', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .patch('/api/banks/1')
      .send({ name: 'Banco Union Empresarial', dailyLimit: 80000 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deps.db.update).toHaveBeenCalled();
    expect(deps.bankManager.loadAccounts).toHaveBeenCalled();
  });

  it('PATCH /api/banks/:id returns 404 for unknown bank', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .patch('/api/banks/999')
      .send({ name: 'Updated' });
    expect(res.status).toBe(404);
  });

  it('PATCH /api/banks/:id returns 400 for empty body', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .patch('/api/banks/1')
      .send({});
    expect(res.status).toBe(400);
  });

  it('PATCH /api/banks/:id can toggle status to inactive', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .patch('/api/banks/1')
      .send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deps.db.update).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `npx vitest run tests/api/banks.test.ts`
Expected: FAIL — `PATCH /api/banks/:id` returns 404 (no route handler yet)

- [ ] **Step 3: Commit**

```bash
git add tests/api/banks.test.ts
git commit -m "test: add failing tests for PATCH /api/banks/:id"
```

---

### Task 3: Implement POST /api/banks endpoint

**Files:**
- Modify: `src/api/routes/banks.ts`

- [ ] **Step 1: Add POST handler**

In `src/api/routes/banks.ts`, add this handler after the `router.get('/banks', ...)` block (after line 42) and before the `router.get('/banks/:id/qr/preview', ...)` block:

```typescript
  // Create a new bank account
  router.post('/banks', async (req, res) => {
    const { name, bank, accountHint, balanceBob, dailyLimit, priority, paymentMessage } = req.body ?? {};

    if (!name || !bank || !accountHint || balanceBob == null || dailyLimit == null) {
      res.status(400).json({ error: 'Missing required fields: name, bank, accountHint, balanceBob, dailyLimit' });
      return;
    }

    try {
      const [inserted] = await deps.db
        .insert(bankAccounts)
        .values({
          name,
          bank,
          accountHint,
          balanceBob,
          dailyLimit,
          priority: priority ?? 0,
          paymentMessage: paymentMessage ?? null,
        })
        .returning({ id: bankAccounts.id });

      await deps.bankManager.loadAccounts();

      log.info({ id: inserted.id, name }, 'Bank account created');
      res.json({ success: true, id: inserted.id });
    } catch (err) {
      log.error({ err }, 'Failed to create bank account');
      res.status(500).json({ error: 'Failed to create bank account' });
    }
  });
```

- [ ] **Step 2: Run POST tests**

Run: `npx vitest run tests/api/banks.test.ts`
Expected: All POST tests pass. PATCH tests still fail.

- [ ] **Step 3: Commit**

```bash
git add src/api/routes/banks.ts
git commit -m "feat: add POST /api/banks endpoint for creating bank accounts"
```

---

### Task 4: Implement PATCH /api/banks/:id endpoint

**Files:**
- Modify: `src/api/routes/banks.ts`

- [ ] **Step 1: Add PATCH handler**

In `src/api/routes/banks.ts`, add this handler after the POST handler (before the QR preview GET handler):

```typescript
  // Update bank account fields
  router.patch('/banks/:id', async (req, res) => {
    const accountId = parseInt(req.params.id, 10);
    const account = deps.bankManager.getAccountById(accountId);
    if (!account) {
      res.status(404).json({ error: 'Bank account not found' });
      return;
    }

    const allowedFields = ['name', 'bank', 'accountHint', 'balanceBob', 'dailyLimit', 'priority', 'paymentMessage', 'status'] as const;
    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    try {
      await deps.db
        .update(bankAccounts)
        .set(updates)
        .where(eq(bankAccounts.id, accountId));

      await deps.bankManager.loadAccounts();

      log.info({ accountId, updates: Object.keys(updates) }, 'Bank account updated');
      res.json({ success: true });
    } catch (err) {
      log.error({ err, accountId }, 'Failed to update bank account');
      res.status(500).json({ error: 'Failed to update bank account' });
    }
  });
```

- [ ] **Step 2: Run all banks tests**

Run: `npx vitest run tests/api/banks.test.ts`
Expected: All 13 tests pass.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/api/routes/banks.ts
git commit -m "feat: add PATCH /api/banks/:id endpoint for updating bank accounts"
```

---

### Task 5: Add dashboard API hooks

**Files:**
- Modify: `dashboard/src/hooks/useApi.ts`

- [ ] **Step 1: Add useCreateBank and useUpdateBank hooks**

In `dashboard/src/hooks/useApi.ts`, add these two hooks after the existing `useDeleteQr` function:

```typescript
export function useCreateBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      bank: string;
      accountHint: string;
      balanceBob: number;
      dailyLimit: number;
      priority?: number;
      paymentMessage?: string;
    }) => {
      const res = await fetch('/api/banks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create bank');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banks'] });
    },
  });
}

export function useUpdateBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bankId, ...data }: {
      bankId: number;
      name?: string;
      bank?: string;
      accountHint?: string;
      balanceBob?: number;
      dailyLimit?: number;
      priority?: number;
      paymentMessage?: string;
      status?: string;
    }) => {
      const res = await fetch(`/api/banks/${bankId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update bank');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banks'] });
    },
  });
}
```

- [ ] **Step 2: Run dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: Clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/hooks/useApi.ts
git commit -m "feat(dashboard): add useCreateBank and useUpdateBank hooks"
```

---

### Task 6: Extend BankQrManager with inline editing and add-account form

**Files:**
- Modify: `dashboard/src/components/BankQrManager.tsx`

- [ ] **Step 1: Rewrite BankQrManager.tsx**

Replace the entire contents of `dashboard/src/components/BankQrManager.tsx` with the following. This extends the existing component with:
- Editable fields in expanded bank rows (name, bank, hint, balance, limit, priority, payment message)
- Status toggle (active/inactive)
- "Add account" form at the bottom
- Inactive accounts shown with reduced opacity

```tsx
import { useState, useRef, useCallback } from 'react';
import { useBanks, useUploadQr, useDeleteQr, useUpdateBank, useCreateBank } from '../hooks/useApi';

function QrDropZone({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) onFile(file);
  }, [onFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <button
      type="button"
      className={`w-full py-6 border-2 border-dashed rounded transition-colors cursor-pointer text-center ${
        dragging
          ? 'border-green-500 bg-green-500/5'
          : 'border-surface-muted/40 hover:border-text-faint'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <span className="text-text-faint text-sm">
        {dragging ? 'Drop image' : 'Drop QR image here or click to browse'}
      </span>
    </button>
  );
}

function QrPreview({ bankId, qrPath }: { bankId: number; qrPath: string }) {
  const deleteQr = useDeleteQr();

  return (
    <div className="flex items-start gap-4">
      <div className="bg-white rounded p-2 shrink-0">
        <img
          src={`/api/banks/${bankId}/qr/preview`}
          alt="QR code"
          className="w-28 h-28 object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
      <div className="flex flex-col gap-2 min-w-0">
        <span className="text-xs text-text-faint truncate" title={qrPath}>
          {qrPath.split('/').pop()}
        </span>
        <button
          type="button"
          className="text-xs text-red-400 hover:text-red-300 transition-colors text-left w-fit"
          onClick={() => deleteQr.mutate(bankId)}
          disabled={deleteQr.isPending}
        >
          {deleteQr.isPending ? 'Removing...' : 'Remove QR'}
        </button>
      </div>
    </div>
  );
}

const fieldClass = 'bg-surface-subtle border border-surface-muted/40 rounded px-2 py-1 text-sm text-text w-full focus:outline-none focus:border-text-faint';
const labelClass = 'text-xs text-text-faint';

type BankData = {
  id: number;
  name: string;
  bank: string;
  accountHint: string;
  balanceBob: number;
  dailyLimit: number;
  priority: number;
  status: string;
  qrCodePath: string | null;
  paymentMessage: string | null;
};

function BankEditForm({ bank, onSave, saving }: {
  bank: BankData;
  onSave: (fields: Record<string, any>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(bank.name);
  const [bankSlug, setBankSlug] = useState(bank.bank);
  const [hint, setHint] = useState(bank.accountHint);
  const [balance, setBalance] = useState(bank.balanceBob.toString());
  const [limit, setLimit] = useState(bank.dailyLimit.toString());
  const [priority, setPriority] = useState(bank.priority.toString());
  const [message, setMessage] = useState(bank.paymentMessage ?? '');

  const dirty =
    name !== bank.name ||
    bankSlug !== bank.bank ||
    hint !== bank.accountHint ||
    balance !== bank.balanceBob.toString() ||
    limit !== bank.dailyLimit.toString() ||
    priority !== bank.priority.toString() ||
    message !== (bank.paymentMessage ?? '');

  const handleSave = () => {
    const fields: Record<string, any> = {};
    if (name !== bank.name) fields.name = name;
    if (bankSlug !== bank.bank) fields.bank = bankSlug;
    if (hint !== bank.accountHint) fields.accountHint = hint;
    if (balance !== bank.balanceBob.toString()) fields.balanceBob = parseFloat(balance);
    if (limit !== bank.dailyLimit.toString()) fields.dailyLimit = parseFloat(limit);
    if (priority !== bank.priority.toString()) fields.priority = parseInt(priority, 10);
    if (message !== (bank.paymentMessage ?? '')) fields.paymentMessage = message || null;
    onSave(fields);
  };

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3">
      <div>
        <div className={labelClass}>Name</div>
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <div className={labelClass}>Bank slug</div>
        <input className={fieldClass} value={bankSlug} onChange={(e) => setBankSlug(e.target.value)} />
      </div>
      <div>
        <div className={labelClass}>Account hint</div>
        <input className={fieldClass} value={hint} onChange={(e) => setHint(e.target.value)} />
      </div>
      <div>
        <div className={labelClass}>Priority</div>
        <input className={fieldClass} type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
      </div>
      <div>
        <div className={labelClass}>Balance BOB</div>
        <input className={fieldClass} type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} />
      </div>
      <div>
        <div className={labelClass}>Daily limit</div>
        <input className={fieldClass} type="number" value={limit} onChange={(e) => setLimit(e.target.value)} />
      </div>
      <div className="col-span-2">
        <div className={labelClass}>Payment message</div>
        <input className={fieldClass} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional" />
      </div>
      <div className="col-span-2 flex justify-end pt-1">
        <button
          type="button"
          className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-500 transition-colors disabled:opacity-40"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function BankRow({ bank }: { bank: BankData }) {
  const [expanded, setExpanded] = useState(false);
  const uploadQr = useUploadQr();
  const updateBank = useUpdateBank();

  const hasQr = !!bank.qrCodePath;
  const isInactive = bank.status === 'inactive';

  return (
    <div className={`border-b border-surface-muted/20 last:border-0 ${isInactive ? 'opacity-50' : ''}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between py-2.5 text-sm hover:bg-surface-subtle/30 transition-colors -mx-2 px-2 rounded"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasQr ? 'bg-green-500' : 'bg-surface-muted'}`}
            title={hasQr ? 'QR uploaded' : 'No QR'}
          />
          <span className="text-text-muted">{bank.name}</span>
          {isInactive && (
            <span className="text-[10px] uppercase tracking-wider text-red-400/70 font-semibold">Inactive</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-num text-text">
            {bank.balanceBob.toFixed(2)}
            <span className="text-text-faint text-xs ml-1">BOB</span>
          </span>
          <svg
            className={`w-3.5 h-3.5 text-text-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="py-3 pl-5">
            {/* Status toggle */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-text-faint">Status</span>
              <button
                type="button"
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  isInactive
                    ? 'bg-surface-muted/40 text-text-faint hover:text-green-400'
                    : 'bg-green-600/20 text-green-400 hover:text-red-400'
                }`}
                onClick={() => updateBank.mutate({
                  bankId: bank.id,
                  status: isInactive ? 'active' : 'inactive',
                })}
                disabled={updateBank.isPending}
              >
                {isInactive ? 'Activate' : 'Deactivate'}
              </button>
            </div>

            {/* QR section */}
            {uploadQr.isPending ? (
              <div className="text-sm text-text-faint py-4 text-center">Uploading...</div>
            ) : hasQr ? (
              <QrPreview bankId={bank.id} qrPath={bank.qrCodePath!} />
            ) : (
              <QrDropZone onFile={(file) => uploadQr.mutate({ bankId: bank.id, file })} />
            )}
            {uploadQr.isError && (
              <div className="text-red-400 text-xs mt-2">Upload failed. Try again.</div>
            )}

            {/* Edit fields */}
            <BankEditForm
              bank={bank}
              onSave={(fields) => updateBank.mutate({ bankId: bank.id, ...fields })}
              saving={updateBank.isPending}
            />
            {updateBank.isError && (
              <div className="text-red-400 text-xs mt-2">Update failed. Try again.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AddBankForm({ onClose }: { onClose: () => void }) {
  const createBank = useCreateBank();
  const [name, setName] = useState('');
  const [bankSlug, setBankSlug] = useState('');
  const [hint, setHint] = useState('');
  const [balance, setBalance] = useState('0');
  const [limit, setLimit] = useState('50000');

  const valid = name.trim() && bankSlug.trim() && hint.trim();

  const handleCreate = () => {
    createBank.mutate(
      {
        name: name.trim(),
        bank: bankSlug.trim(),
        accountHint: hint.trim(),
        balanceBob: parseFloat(balance) || 0,
        dailyLimit: parseFloat(limit) || 0,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <div className="border border-surface-muted/30 rounded p-3 mt-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <div className={labelClass}>Name *</div>
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Banco Union Personal" />
        </div>
        <div>
          <div className={labelClass}>Bank slug *</div>
          <input className={fieldClass} value={bankSlug} onChange={(e) => setBankSlug(e.target.value)} placeholder="banco-union" />
        </div>
        <div>
          <div className={labelClass}>Account hint *</div>
          <input className={fieldClass} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="4521" />
        </div>
        <div>
          <div className={labelClass}>Balance BOB</div>
          <input className={fieldClass} type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </div>
        <div>
          <div className={labelClass}>Daily limit</div>
          <input className={fieldClass} type="number" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <div className="flex items-end">
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-500 transition-colors disabled:opacity-40"
              disabled={!valid || createBank.isPending}
              onClick={handleCreate}
            >
              {createBank.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              className="text-xs px-3 py-1 rounded text-text-faint hover:text-text transition-colors"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
      {createBank.isError && (
        <div className="text-red-400 text-xs mt-2">Failed to create account. Try again.</div>
      )}
    </div>
  );
}

export default function BankQrManager() {
  const { data: banks, isLoading } = useBanks();
  const [showAdd, setShowAdd] = useState(false);

  if (isLoading) return <div className="text-text-faint text-sm">Loading banks...</div>;

  return (
    <div>
      {banks && banks.length > 0 ? (
        banks.map((bank) => (
          <BankRow key={bank.id} bank={bank as BankData} />
        ))
      ) : (
        <div className="text-text-faint text-sm py-2">No bank accounts configured.</div>
      )}

      {showAdd ? (
        <AddBankForm onClose={() => setShowAdd(false)} />
      ) : (
        <button
          type="button"
          className="text-xs text-text-faint hover:text-text-muted transition-colors mt-3"
          onClick={() => setShowAdd(true)}
        >
          + Add account
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run dashboard typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: Clean, no errors.

- [ ] **Step 3: Build dashboard to verify**

Run: `cd dashboard && npx vite build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/BankQrManager.tsx
git commit -m "feat(dashboard): inline bank editing, status toggle, add-account form"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run backend typecheck**

Run: `npx tsc --noEmit`
Expected: Clean, no errors.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Build dashboard**

Run: `cd dashboard && npx vite build`
Expected: Build succeeds.
