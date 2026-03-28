import { eq } from 'drizzle-orm';
import { bankAccounts } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { EventBus } from '../../event-bus.js';
import { selectBestAccount } from './selector.js';
import type { BankAccountRecord, SelectionCriteria } from './types.js';

const LOW_BALANCE_THRESHOLD = 1000;

export class BankManager {
  private readonly db: DB;
  private readonly bus: EventBus;
  private accounts: BankAccountRecord[] = [];

  constructor(db: DB, bus: EventBus) {
    this.db = db;
    this.bus = bus;
  }

  async loadAccounts(): Promise<void> {
    const rows = await this.db.select().from(bankAccounts);
    this.accounts = rows.map((row) => ({
      id: row.id,
      name: row.name,
      bank: row.bank,
      accountHint: row.accountHint,
      balanceBob: row.balanceBob,
      dailyVolume: row.dailyVolume,
      dailyLimit: row.dailyLimit,
      monthlyVolume: row.monthlyVolume,
      status: row.status,
      priority: row.priority,
    }));
  }

  getAccounts(): BankAccountRecord[] {
    return this.accounts;
  }

  getAccountById(id: number): BankAccountRecord | undefined {
    return this.accounts.find((a) => a.id === id);
  }

  selectAccount(criteria: SelectionCriteria): BankAccountRecord | null {
    return selectBestAccount(this.accounts, criteria);
  }

  async updateBalanceAfterTrade(accountId: number, bobDelta: number): Promise<void> {
    const account = this.accounts.find((a) => a.id === accountId);
    if (!account) return;

    const newBalance = account.balanceBob + bobDelta;
    const newDailyVolume = account.dailyVolume + Math.abs(bobDelta);

    // Update in-memory
    account.balanceBob = newBalance;
    account.dailyVolume = newDailyVolume;

    // Update DB
    await this.db
      .update(bankAccounts)
      .set({ balanceBob: newBalance, dailyVolume: newDailyVolume })
      .where(eq(bankAccounts.id, accountId));

    // Emit low-balance event if applicable
    if (newBalance < LOW_BALANCE_THRESHOLD) {
      await this.bus.emit(
        'bank:low-balance',
        { accountId, balance: newBalance, threshold: LOW_BALANCE_THRESHOLD },
        'BankManager',
      );
    }

    // Emit daily-limit event if at or over limit
    if (newDailyVolume >= account.dailyLimit) {
      await this.bus.emit(
        'bank:daily-limit',
        { accountId, dailyVolume: newDailyVolume, limit: account.dailyLimit },
        'BankManager',
      );
    }
  }

  async setBalance(accountId: number, balance: number): Promise<void> {
    const account = this.accounts.find((a) => a.id === accountId);
    if (!account) return;

    account.balanceBob = balance;

    await this.db
      .update(bankAccounts)
      .set({ balanceBob: balance })
      .where(eq(bankAccounts.id, accountId));
  }

  async resetDailyVolumes(): Promise<void> {
    for (const account of this.accounts) {
      account.dailyVolume = 0;
    }

    await this.db.update(bankAccounts).set({ dailyVolume: 0 });
  }

  getTotalBobBalance(): number {
    return this.accounts
      .filter((a) => a.status === 'active')
      .reduce((sum, a) => sum + a.balanceBob, 0);
  }
}
