export type OrderStatus = 'new' | 'awaiting_payment' | 'payment_marked' | 'released' | 'cancelled' | 'disputed';

export interface TrackedOrder {
  id: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  totalBob: number;
  status: OrderStatus;
  counterpartyId: string;
  counterpartyName: string;
  bankAccountId: number;
  createdAt: number;
  autoCancelAt: number | null;
}
