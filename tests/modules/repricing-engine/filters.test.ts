import { describe, it, expect } from 'vitest';
import { applyFilters } from '../../../src/modules/repricing-engine/filters.js';
import type { OrderBookAd } from '../../../src/bybit/types.js';
import type { OrderBookFilters } from '../../../src/modules/repricing-engine/types.js';

const makeAd = (overrides: Partial<OrderBookAd> = {}): OrderBookAd => ({
  id: '1',
  side: 'sell',
  price: 9.345,
  quantity: 500,
  minAmount: 10,
  maxAmount: 5000,
  nickName: 'TestMerchant',
  userId: 'user-1',
  recentOrderNum: 50,
  recentExecuteRate: 95,
  authTag: ['GA'],
  authStatus: 2,
  isOnline: true,
  userType: 'PERSONAL',
  ...overrides,
});

const defaultFilters: OrderBookFilters = {
  minOrderAmount: 100,
  verifiedOnly: true,
  minCompletionRate: 80,
  minOrderCount: 10,
  merchantLevels: ['GA', 'VA'],
};

describe('applyFilters', () => {
  it('returns all ads when all pass filters', () => {
    const ads = [
      makeAd({ id: '1', userId: 'user-2' }),
      makeAd({ id: '2', userId: 'user-3', authTag: ['VA'] }),
    ];
    const result = applyFilters(ads, defaultFilters, 'self-user');
    expect(result).toHaveLength(2);
  });

  it('excludes own ads by userId', () => {
    const ads = [
      makeAd({ id: '1', userId: 'self-user' }),
      makeAd({ id: '2', userId: 'user-2' }),
    ];
    const result = applyFilters(ads, defaultFilters, 'self-user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('excludes outlier prices below PRICE_FLOOR (< 8 BOB)', () => {
    const ads = [
      makeAd({ id: '1', userId: 'user-2', price: 7.99 }),
      makeAd({ id: '2', userId: 'user-3', price: 9.5 }),
    ];
    const result = applyFilters(ads, defaultFilters, 'self-user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('excludes outlier prices above PRICE_CEILING (> 12 BOB)', () => {
    const ads = [
      makeAd({ id: '1', userId: 'user-2', price: 12.01 }),
      makeAd({ id: '2', userId: 'user-3', price: 10.0 }),
    ];
    const result = applyFilters(ads, defaultFilters, 'self-user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('filters by minOrderAmount (maxAmount < threshold)', () => {
    const ads = [
      makeAd({ id: '1', userId: 'user-2', maxAmount: 50 }),
      makeAd({ id: '2', userId: 'user-3', maxAmount: 5000 }),
    ];
    const filters = { ...defaultFilters, minOrderAmount: 100 };
    const result = applyFilters(ads, filters, 'self-user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('filters unverified ads when verifiedOnly is true', () => {
    const ads = [
      makeAd({ id: '1', userId: 'user-2', authStatus: 0 }),
      makeAd({ id: '2', userId: 'user-3', authStatus: 2 }),
    ];
    const filters = { ...defaultFilters, verifiedOnly: true };
    const result = applyFilters(ads, filters, 'self-user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('does not filter unverified ads when verifiedOnly is false', () => {
    const ads = [
      makeAd({ id: '1', userId: 'user-2', authStatus: 0 }),
      makeAd({ id: '2', userId: 'user-3', authStatus: 2 }),
    ];
    const filters = { ...defaultFilters, verifiedOnly: false };
    const result = applyFilters(ads, filters, 'self-user');
    expect(result).toHaveLength(2);
  });

  it('filters by minCompletionRate', () => {
    const ads = [
      makeAd({ id: '1', userId: 'user-2', recentExecuteRate: 75 }),
      makeAd({ id: '2', userId: 'user-3', recentExecuteRate: 90 }),
    ];
    const filters = { ...defaultFilters, minCompletionRate: 80 };
    const result = applyFilters(ads, filters, 'self-user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('filters by minOrderCount', () => {
    const ads = [
      makeAd({ id: '1', userId: 'user-2', recentOrderNum: 5 }),
      makeAd({ id: '2', userId: 'user-3', recentOrderNum: 25 }),
    ];
    const filters = { ...defaultFilters, minOrderCount: 10 };
    const result = applyFilters(ads, filters, 'self-user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('filters by merchantLevels (authTag)', () => {
    const ads = [
      makeAd({ id: '1', userId: 'user-2', authTag: ['BASIC'] }),
      makeAd({ id: '2', userId: 'user-3', authTag: ['GA'] }),
      makeAd({ id: '3', userId: 'user-4', authTag: ['VA'] }),
    ];
    const filters = { ...defaultFilters, merchantLevels: ['GA', 'VA'] };
    const result = applyFilters(ads, filters, 'self-user');
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id)).toEqual(['2', '3']);
  });

  it('allows ads with empty authTag when merchantLevels is empty', () => {
    const ads = [
      makeAd({ id: '1', userId: 'user-2', authTag: [] }),
      makeAd({ id: '2', userId: 'user-3', authTag: ['GA'] }),
    ];
    const filters = { ...defaultFilters, merchantLevels: [] };
    const result = applyFilters(ads, filters, 'self-user');
    expect(result).toHaveLength(2);
  });
});
