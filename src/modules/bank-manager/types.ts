export interface BankAccountRecord {
  id: number;
  name: string;
  bank: string;
  accountHint: string;
  balanceBob: number;
  dailyVolume: number;
  dailyLimit: number;
  monthlyVolume: number;
  status: string;
  priority: number;
}

export interface SelectionCriteria {
  minBalance: number;
  side: 'buy' | 'sell';
}
