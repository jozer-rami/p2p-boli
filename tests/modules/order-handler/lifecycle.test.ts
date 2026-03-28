import { describe, it, expect } from 'vitest';
import { canTransition, transitionOrder } from '../../../src/modules/order-handler/lifecycle.js';
import type { OrderStatus } from '../../../src/modules/order-handler/types.js';

describe('canTransition', () => {
  it('allows new → awaiting_payment', () => {
    expect(canTransition('new', 'awaiting_payment')).toBe(true);
  });

  it('allows new → cancelled', () => {
    expect(canTransition('new', 'cancelled')).toBe(true);
  });

  it('allows awaiting_payment → payment_marked', () => {
    expect(canTransition('awaiting_payment', 'payment_marked')).toBe(true);
  });

  it('allows awaiting_payment → cancelled', () => {
    expect(canTransition('awaiting_payment', 'cancelled')).toBe(true);
  });

  it('allows payment_marked → released', () => {
    expect(canTransition('payment_marked', 'released')).toBe(true);
  });

  it('allows payment_marked → disputed', () => {
    expect(canTransition('payment_marked', 'disputed')).toBe(true);
  });

  it('allows disputed → released', () => {
    expect(canTransition('disputed', 'released')).toBe(true);
  });

  it('allows disputed → cancelled', () => {
    expect(canTransition('disputed', 'cancelled')).toBe(true);
  });

  it('rejects new → released (invalid skip)', () => {
    expect(canTransition('new', 'released')).toBe(false);
  });

  it('rejects released → any state (terminal state)', () => {
    const targets: OrderStatus[] = ['new', 'awaiting_payment', 'payment_marked', 'cancelled', 'disputed'];
    for (const target of targets) {
      expect(canTransition('released', target)).toBe(false);
    }
  });
});

describe('transitionOrder', () => {
  it('returns the new status on a valid transition', () => {
    expect(transitionOrder('new', 'awaiting_payment')).toBe('awaiting_payment');
  });

  it('throws on an invalid transition', () => {
    expect(() => transitionOrder('released', 'new')).toThrow(
      "Invalid transition: released → new",
    );
  });

  it('throws when attempting to leave cancelled (terminal state)', () => {
    expect(() => transitionOrder('cancelled', 'new')).toThrow(
      "Invalid transition: cancelled → new",
    );
  });
});
