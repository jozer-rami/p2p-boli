// tests/integration/chat-relay.test.ts
import { describe, it, expect } from 'vitest';
import { createTestClient, hasCredentials } from './setup.js';

describe.skipIf(!hasCredentials)('Chat Relay API', () => {
  const client = createTestClient();

  describe('getOrderMessages', () => {
    it('returns array for a pending order (if any exist)', async () => {
      let orders;
      try {
        orders = await client.getPendingOrders();
      } catch (e: any) {
        if (e.message.includes('Account does not exist')) {
          console.warn('Skipping getOrderMessages test: P2P merchant profile not set up on testnet');
          return;
        }
        throw e;
      }

      if (orders.length === 0) {
        console.warn('Skipping getOrderMessages test: no pending orders on testnet');
        return;
      }

      const messages = await client.getOrderMessages(orders[0].id);

      expect(Array.isArray(messages)).toBe(true);

      for (const msg of messages) {
        expect(typeof msg.content).toBe('string');
        expect(typeof msg.contentType).toBe('string');
        expect(typeof msg.sendTime).toBe('number');
        expect(typeof msg.fromUserId).toBe('string');
        expect(typeof msg.roleType).toBe('string');
        expect(typeof msg.nickName).toBe('string');
      }
    });

    it('throws for invalid orderId', async () => {
      await expect(client.getOrderMessages('invalid-order-id-12345'))
        .rejects.toThrow();
    });
  });
});
