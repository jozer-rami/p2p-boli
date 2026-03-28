import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDB, schema } from '../../../src/db/index.js';
import { EventBus } from '../../../src/event-bus.js';
import { BankManager } from '../../../src/modules/bank-manager/index.js';
import type { DB } from '../../../src/db/index.js';

let db: DB;
let close: () => void;
let bus: EventBus;
let manager: BankManager;

beforeEach(() => {
  ({ db, close } = createTestDB());
  bus = new EventBus(db);
  manager = new BankManager(db, bus);

  db.insert(schema.bankAccounts).values({
    name: 'Banco Union',
    bank: 'banco-union',
    accountHint: '4521',
    balanceBob: 15000,
    dailyLimit: 50000,
    priority: 10,
    updatedAt: String(Date.now()),
  }).run();
});

afterEach(() => {
  bus.removeAllListeners();
  close();
});

describe('BankManager', () => {
  it('loads accounts from DB', async () => {
    await manager.loadAccounts();
    const accounts = manager.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Banco Union');
    expect(accounts[0].balanceBob).toBe(15000);
  });

  it('selects best account for a trade', async () => {
    await manager.loadAccounts();
    const account = manager.selectAccount({ minBalance: 1000, side: 'buy' });
    expect(account).not.toBeNull();
    expect(account?.name).toBe('Banco Union');
  });

  it('updates balance after trade', async () => {
    await manager.loadAccounts();
    const accounts = manager.getAccounts();
    const accountId = accounts[0].id;

    await manager.updateBalanceAfterTrade(accountId, -5000);

    const updated = manager.getAccountById(accountId);
    expect(updated?.balanceBob).toBe(10000);
  });

  it('emits bank:low-balance when balance drops below 1000', async () => {
    await manager.loadAccounts();
    const accounts = manager.getAccounts();
    const accountId = accounts[0].id;

    const emitted: { accountId: number; balance: number; threshold: number }[] = [];
    bus.on('bank:low-balance', (payload) => {
      emitted.push(payload);
    });

    // Drop balance from 15000 to 500 (below threshold)
    await manager.updateBalanceAfterTrade(accountId, -14500);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].accountId).toBe(accountId);
    expect(emitted[0].balance).toBe(500);
    expect(emitted[0].threshold).toBe(1000);
  });
});
