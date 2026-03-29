// tests/integration/balance.test.ts
import { describe, it, expect } from 'vitest';
import { createTestClient, hasCredentials } from './setup.js';

describe.skipIf(!hasCredentials)('Balance API', () => {
  const client = createTestClient();

  it('getBalance returns valid shape for USDT', async () => {
    const balance = await client.getBalance('USDT');

    expect(balance).toHaveProperty('coin', 'USDT');
    expect(typeof balance.available).toBe('number');
    expect(typeof balance.frozen).toBe('number');
    expect(balance.available).toBeGreaterThanOrEqual(0);
    expect(balance.frozen).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(balance.available)).toBe(false);
    expect(Number.isNaN(balance.frozen)).toBe(false);
  });

  it('getBalance throws for invalid coin', async () => {
    await expect(client.getBalance('NONEXISTENT')).rejects.toThrow('getBalance failed');
  });
});
