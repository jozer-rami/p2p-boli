import { describe, it, expect } from 'vitest';
import { ReplayPriceSource } from '../../src/simulator/mocks/replay-price-source.js';
import { MockBybitClient } from '../../src/simulator/mocks/mock-bybit-client.js';
import type { ScenarioTick } from '../../src/simulator/types.js';

describe('ReplayPriceSource', () => {
  const ticks: ScenarioTick[] = [
    { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
    { ask: 6.91, bid: 6.87, totalAsk: 300, totalBid: 200 },
  ];

  it('returns ticks as PlatformPrices in sequence', async () => {
    const source = new ReplayPriceSource(ticks);
    const first = await source.getUsdtBobPrices();
    expect(first).toHaveLength(1);
    expect(first[0].platform).toBe('bybitp2p');
    expect(first[0].ask).toBe(6.92);
    expect(first[0].bid).toBe(6.89);

    const second = await source.getUsdtBobPrices();
    expect(second[0].ask).toBe(6.91);
  });

  it('returns empty array after all ticks are consumed', async () => {
    const source = new ReplayPriceSource(ticks);
    await source.getUsdtBobPrices(); // tick 0
    await source.getUsdtBobPrices(); // tick 1
    const empty = await source.getUsdtBobPrices(); // past end
    expect(empty).toHaveLength(1);
    expect(empty[0].ask).toBe(0);
    expect(empty[0].bid).toBe(0);
  });

  it('injects clock time into the PlatformPrices', async () => {
    const source = new ReplayPriceSource(ticks);
    source.setTime(60_000);
    const prices = await source.getUsdtBobPrices();
    expect(prices[0].time).toBe(60); // seconds
  });
});

describe('MockBybitClient', () => {
  it('tracks created ads', async () => {
    const client = new MockBybitClient();
    const adId = await client.createAd({
      side: '0', // sell
      price: '6.92',
      amount: '300',
      currencyId: 'USDT',
      fiatId: 'BOB',
      paymentIds: ['1'],
    });

    expect(adId).toBeTruthy();
    expect(client.getAdLog()).toHaveLength(1);
    expect(client.getAdLog()[0].action).toBe('create');
  });

  it('tracks reprices via updateAd', async () => {
    const client = new MockBybitClient();
    const adId = await client.createAd({
      side: '0',
      price: '6.92',
      amount: '300',
      currencyId: 'USDT',
      fiatId: 'BOB',
      paymentIds: ['1'],
    });

    await client.updateAd(adId, 6.93, 300);
    const log = client.getAdLog();
    expect(log).toHaveLength(2);
    expect(log[1].action).toBe('reprice');
    expect(log[1].price).toBe(6.93);
  });

  it('tracks cancellations', async () => {
    const client = new MockBybitClient();
    const adId = await client.createAd({
      side: '0',
      price: '6.92',
      amount: '300',
      currencyId: 'USDT',
      fiatId: 'BOB',
      paymentIds: ['1'],
    });

    await client.cancelAd(adId);
    const log = client.getAdLog();
    expect(log).toHaveLength(2);
    expect(log[1].action).toBe('cancel');
  });

  it('returns configured online ads for getOnlineAds', async () => {
    const client = new MockBybitClient();
    const ads = await client.getOnlineAds('sell', 'USDT', 'BOB');
    expect(ads).toEqual([]);
  });
});
