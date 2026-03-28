import { describe, it, expect } from 'vitest';
import { selectBestAccount } from '../../../src/modules/bank-manager/selector.js';
import type { BankAccountRecord, SelectionCriteria } from '../../../src/modules/bank-manager/types.js';

function makeAccount(overrides: Partial<BankAccountRecord> = {}): BankAccountRecord {
  return {
    id: 1,
    name: 'Test Account',
    bank: 'test-bank',
    accountHint: '1234',
    balanceBob: 10000,
    dailyVolume: 0,
    dailyLimit: 50000,
    monthlyVolume: 0,
    status: 'active',
    priority: 5,
    ...overrides,
  };
}

describe('selectBestAccount', () => {
  it('returns null when no accounts are provided', () => {
    const criteria: SelectionCriteria = { minBalance: 1000, side: 'buy' };
    expect(selectBestAccount([], criteria)).toBeNull();
  });

  it('filters out inactive accounts', () => {
    const accounts = [makeAccount({ status: 'inactive' })];
    const criteria: SelectionCriteria = { minBalance: 1000, side: 'buy' };
    expect(selectBestAccount(accounts, criteria)).toBeNull();
  });

  it('filters accounts with insufficient balance for buy side', () => {
    const accounts = [makeAccount({ balanceBob: 500 })];
    const criteria: SelectionCriteria = { minBalance: 1000, side: 'buy' };
    expect(selectBestAccount(accounts, criteria)).toBeNull();
  });

  it('does NOT filter by balance for sell side', () => {
    const accounts = [makeAccount({ balanceBob: 0 })];
    const criteria: SelectionCriteria = { minBalance: 1000, side: 'sell' };
    const result = selectBestAccount(accounts, criteria);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(1);
  });

  it('filters accounts at their daily limit', () => {
    const accounts = [makeAccount({ dailyVolume: 50000, dailyLimit: 50000 })];
    const criteria: SelectionCriteria = { minBalance: 1000, side: 'buy' };
    expect(selectBestAccount(accounts, criteria)).toBeNull();
  });

  it('prefers account with higher priority', () => {
    const accounts = [
      makeAccount({ id: 1, priority: 3 }),
      makeAccount({ id: 2, priority: 10 }),
    ];
    const criteria: SelectionCriteria = { minBalance: 1000, side: 'buy' };
    const result = selectBestAccount(accounts, criteria);
    expect(result?.id).toBe(2);
  });

  it('considers remaining daily capacity in scoring', () => {
    // Same priority, but account 2 has more remaining capacity
    const accounts = [
      makeAccount({ id: 1, priority: 5, dailyVolume: 45000, dailyLimit: 50000 }), // 10% remaining
      makeAccount({ id: 2, priority: 5, dailyVolume: 5000, dailyLimit: 50000 }),  // 90% remaining
    ];
    const criteria: SelectionCriteria = { minBalance: 1000, side: 'buy' };
    const result = selectBestAccount(accounts, criteria);
    expect(result?.id).toBe(2);
  });
});
