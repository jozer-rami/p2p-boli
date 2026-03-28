import type { OrderStatus } from './types.js';

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['awaiting_payment', 'cancelled'],
  awaiting_payment: ['payment_marked', 'cancelled'],
  payment_marked: ['released', 'disputed'],
  released: [],
  cancelled: [],
  disputed: ['released', 'cancelled'],
};

/**
 * Returns true if transitioning from `from` to `to` is a valid state-machine step.
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Validates and performs the transition, returning the new status.
 * Throws if the transition is not allowed.
 */
export function transitionOrder(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
  return to;
}
