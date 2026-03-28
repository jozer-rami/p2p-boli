import { describe, it, expect, vi, afterEach } from 'vitest';
import { CriptoYaClient } from '../../../src/modules/price-monitor/criptoya.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CriptoYaClient', () => {
  it('parses USDT/BOB prices from mock response', async () => {
    const mockData = {
      binance: { ask: 9.40, totalAsk: 1000, bid: 9.35, totalBid: 2000, time: 1700000000 },
      bybit: { ask: 9.42, totalAsk: 500, bid: 9.36, totalBid: 800, time: 1700000001 },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const client = new CriptoYaClient();
    const prices = await client.getUsdtBobPrices();

    expect(prices).toHaveLength(2);

    const binance = prices.find((p) => p.platform === 'binance');
    expect(binance).toBeDefined();
    expect(binance!.ask).toBe(9.40);
    expect(binance!.bid).toBe(9.35);
    expect(binance!.totalAsk).toBe(1000);
    expect(binance!.totalBid).toBe(2000);
    expect(binance!.time).toBe(1700000000);

    const bybit = prices.find((p) => p.platform === 'bybit');
    expect(bybit).toBeDefined();
    expect(bybit!.ask).toBe(9.42);
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    const client = new CriptoYaClient();
    await expect(client.getUsdtBobPrices()).rejects.toThrow('CriptoYa request failed: 503');
  });
});
