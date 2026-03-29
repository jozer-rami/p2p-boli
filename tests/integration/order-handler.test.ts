// tests/integration/order-handler.test.ts
import { describe, it, expect } from 'vitest';
import { createTestClient, hasCredentials } from './setup.js';

describe.skipIf(!hasCredentials)('Order Handler API', () => {
  const client = createTestClient();

  describe('getPendingOrders', () => {
    it('returns array with valid order shapes', async () => {
      let orders;
      try {
        orders = await client.getPendingOrders();
      } catch (e: any) {
        if (e.message.includes('Account does not exist')) {
          console.warn('Skipping: P2P merchant profile not set up on testnet');
          return;
        }
        throw e;
      }

      expect(Array.isArray(orders)).toBe(true);

      for (const order of orders) {
        expect(typeof order.id).toBe('string');
        // Side must be normalized, not raw 0/1
        expect(['buy', 'sell']).toContain(order.side);
        expect(typeof order.amount).toBe('number');
        expect(Number.isNaN(order.amount)).toBe(false);
        expect(typeof order.price).toBe('number');
        expect(Number.isNaN(order.price)).toBe(false);
        expect(typeof order.totalBob).toBe('number');
        expect(typeof order.status).toBe('string');
        expect(typeof order.createdAt).toBe('number');
        expect(Number.isNaN(order.createdAt)).toBe(false);
      }
    });

    it('does not contain terminal status orders (40, 50)', async () => {
      let orders;
      try {
        orders = await client.getPendingOrders();
      } catch (e: any) {
        if (e.message.includes('Account does not exist')) {
          console.warn('Skipping: P2P merchant profile not set up on testnet');
          return;
        }
        throw e;
      }

      for (const order of orders) {
        expect(['40', '50']).not.toContain(order.status);
      }
    });
  });

  describe('getOrderDetail', () => {
    it('throws with descriptive error for invalid orderId', async () => {
      await expect(client.getOrderDetail('invalid-order-id-12345'))
        .rejects.toThrow();
    });

    it('returns valid shape for a real order (if any exist)', async () => {
      // Try to find a real order to test detail endpoint
      let orders;
      try {
        orders = await client.getPendingOrders();
      } catch (e: any) {
        if (e.message.includes('Account does not exist')) {
          console.warn('Skipping getOrderDetail shape test: P2P merchant profile not set up on testnet');
          return;
        }
        throw e;
      }

      if (orders.length === 0) {
        console.warn('Skipping getOrderDetail shape test: no pending orders on testnet');
        return;
      }

      const detail = await client.getOrderDetail(orders[0].id);

      expect(typeof detail.id).toBe('string');
      expect(['buy', 'sell']).toContain(detail.side);
      expect(typeof detail.amount).toBe('number');
      expect(typeof detail.price).toBe('number');
      expect(typeof detail.totalBob).toBe('number');
      expect(typeof detail.status).toBe('string');
    });
  });
});
