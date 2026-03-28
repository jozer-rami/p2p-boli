import { describe, it, expect } from 'vitest';
import {
  formatOrderNew,
  formatOrderReleased,
  formatEmergency,
} from '../../../src/modules/telegram/alerts.js';

describe('formatOrderNew', () => {
  it('includes order ID, side, amount, price, and counterparty', () => {
    const result = formatOrderNew({
      orderId: 'ORD-001',
      side: 'buy',
      amount: 500,
      price: 6.95,
      counterparty: 'alice123',
    });

    expect(result).toContain('ORD-001');
    expect(result).toContain('BUY');
    expect(result).toContain('500');
    expect(result).toContain('6.95');
    expect(result).toContain('alice123');
  });
});

describe('formatOrderReleased', () => {
  it('includes order ID, amount, and profit', () => {
    const result = formatOrderReleased({
      orderId: 'ORD-042',
      amount: 200,
      profit: 14.5,
    });

    expect(result).toContain('ORD-042');
    expect(result).toContain('200');
    expect(result).toContain('14.50');
  });
});

describe('formatEmergency', () => {
  it('includes trigger type, exposure values, and pending order count', () => {
    const result = formatEmergency({
      trigger: 'volatility',
      reason: 'Price changed 3.5% in 5min',
      exposure: { usdt: 1000.5, bob: 7200.75 },
      marketState: { ask: 7.1, bid: 6.9 },
      pendingOrders: 3,
    });

    expect(result).toContain('volatility');
    expect(result).toContain('1000.50');
    expect(result).toContain('7200.75');
    expect(result).toContain('3');
  });
});
