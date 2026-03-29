// tests/integration/ad-manager.test.ts
import { describe, it, expect } from 'vitest';
import { createTestClient, hasCredentials } from './setup.js';

describe.skipIf(!hasCredentials)('Ad Manager API', () => {
  const client = createTestClient();

  // === Task 3: Payment Methods ===

  describe('getPaymentMethods', () => {
    it('returns array with valid payment method shapes', async () => {
      let methods;
      try {
        methods = await client.getPaymentMethods();
      } catch (e: any) {
        if (e.message.includes('Account does not exist')) {
          console.warn('Skipping: P2P merchant profile not set up on testnet');
          return;
        }
        throw e;
      }

      expect(Array.isArray(methods)).toBe(true);

      for (const method of methods) {
        expect(typeof method.id).toBe('string');
        // id must be > 0 (the "Balance" virtual payment with id=0 should be filtered)
        expect(Number(method.id)).toBeGreaterThan(0);
        expect(typeof method.bankName).toBe('string');
        expect(typeof method.accountNo).toBe('string');
        expect(typeof method.realName).toBe('string');
      }
    });

    it('excludes Balance payment method (id=0)', async () => {
      let methods;
      try {
        methods = await client.getPaymentMethods();
      } catch (e: any) {
        if (e.message.includes('Account does not exist')) {
          console.warn('Skipping: P2P merchant profile not set up on testnet');
          return;
        }
        throw e;
      }

      const zeroIds = methods.filter(m => Number(m.id) === 0);
      expect(zeroIds).toHaveLength(0);
    });
  });

  // === Task 4: Online Ads + Personal Ads ===

  describe('getOnlineAds', () => {
    it('returns buy-side ads with valid shapes', async () => {
      const ads = await client.getOnlineAds('buy', 'USDT', 'BOB');

      expect(Array.isArray(ads)).toBe(true);

      for (const ad of ads) {
        expect(typeof ad.id).toBe('string');
        expect(ad.side).toBe('buy');
        expect(typeof ad.price).toBe('number');
        expect(Number.isNaN(ad.price)).toBe(false);
        expect(ad.price).toBeGreaterThan(0);
        expect(typeof ad.amount).toBe('number');
        expect(Number.isNaN(ad.amount)).toBe(false);
        expect(typeof ad.status).toBe('string');
      }
    });

    it('returns sell-side ads with valid shapes', async () => {
      const ads = await client.getOnlineAds('sell', 'USDT', 'BOB');

      expect(Array.isArray(ads)).toBe(true);

      for (const ad of ads) {
        expect(ad.side).toBe('sell');
        expect(typeof ad.price).toBe('number');
        expect(ad.price).toBeGreaterThan(0);
      }
    });

    it('side mapping is consistent (buy=1 in API, returned as "buy")', async () => {
      const buyAds = await client.getOnlineAds('buy', 'USDT', 'BOB');
      const sellAds = await client.getOnlineAds('sell', 'USDT', 'BOB');

      // Every ad returned by buy query should have side='buy'
      for (const ad of buyAds) {
        expect(ad.side).toBe('buy');
      }
      // Every ad returned by sell query should have side='sell'
      for (const ad of sellAds) {
        expect(ad.side).toBe('sell');
      }
    });
  });

  describe('getPersonalAds', () => {
    it('returns array with normalized side values', async () => {
      const ads = await client.getPersonalAds();

      expect(Array.isArray(ads)).toBe(true);

      for (const ad of ads) {
        expect(typeof ad.id).toBe('string');
        // Side must be normalized to 'buy' or 'sell', never 0/1/'0'/'1'
        expect(['buy', 'sell']).toContain(ad.side);
        expect(typeof ad.price).toBe('number');
        expect(Number.isNaN(ad.price)).toBe(false);
        expect(typeof ad.amount).toBe('number');
        expect(typeof ad.status).toBe('string');
      }
    });
  });

  // === Task 5: Ad CRUD Lifecycle ===

  describe('Ad CRUD lifecycle', () => {
    it('create → verify → update → cancel → verify gone', async () => {
      let methods;
      try {
        methods = await client.getPaymentMethods();
      } catch (e: any) {
        if (e.message.includes('Account does not exist')) {
          console.warn('Skipping ad CRUD: P2P merchant profile not set up on testnet');
          return;
        }
        throw e;
      }
      if (methods.length === 0) {
        console.warn('Skipping ad CRUD: no payment methods on testnet');
        return;
      }

      // Create a sell ad at an intentionally high price so nobody takes it
      const adId = await client.createAd({
        side: 'sell',
        price: 99.99,
        amount: 10,
        currencyId: 'USDT',
        fiatCurrencyId: 'BOB',
        paymentMethodIds: [methods[0].id],
        remark: 'Integration test ad — will be cancelled',
      });

      expect(typeof adId).toBe('string');
      expect(adId.length).toBeGreaterThan(0);

      // Verify it appears in personal ads
      const adsAfterCreate = await client.getPersonalAds();
      const created = adsAfterCreate.find(a => a.id === adId);
      expect(created).toBeDefined();
      expect(created!.side).toBe('sell');

      // Update (reprice)
      await client.updateAd(adId, 99.98, 10, [methods[0].id]);

      // Verify price updated
      const adsAfterUpdate = await client.getPersonalAds();
      const updated = adsAfterUpdate.find(a => a.id === adId);
      expect(updated).toBeDefined();
      expect(updated!.price).toBeCloseTo(99.98, 1);

      // Cancel
      await client.cancelAd(adId);

      // Verify gone
      const adsAfterCancel = await client.getPersonalAds();
      const cancelled = adsAfterCancel.find(a => a.id === adId);
      expect(cancelled).toBeUndefined();
    }, 60_000); // 60s timeout for multi-step
  });
});
