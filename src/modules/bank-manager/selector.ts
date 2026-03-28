import type { BankAccountRecord, SelectionCriteria } from './types.js';

export function selectBestAccount(
  accounts: BankAccountRecord[],
  criteria: SelectionCriteria,
): BankAccountRecord | null {
  const eligible = accounts.filter((account) => {
    // Must be active
    if (account.status !== 'active') return false;

    // Must not be at daily limit
    if (account.dailyVolume >= account.dailyLimit) return false;

    // Buy side requires sufficient BOB balance
    if (criteria.side === 'buy' && account.balanceBob < criteria.minBalance) return false;

    return true;
  });

  if (eligible.length === 0) return null;

  // Score: priority * remaining_daily_capacity_ratio
  const scored = eligible.map((account) => {
    const remainingCapacityRatio = (account.dailyLimit - account.dailyVolume) / account.dailyLimit;
    const score = account.priority * remainingCapacityRatio;
    return { account, score };
  });

  // Sort descending by score, return best
  scored.sort((a, b) => b.score - a.score);
  return scored[0].account;
}
