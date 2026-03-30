import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceMonitor } from '../../../src/modules/price-monitor/index.js';
import { EventBus } from '../../../src/event-bus.js';
import { createTestDB } from '../../../src/db/index.js';
import type { DB } from '../../../src/db/index.js';

type MockClient = {
  getUsdtBobPrices: ReturnType<typeof vi.fn>;
  getFees: ReturnType<typeof vi.fn>;
};

let db: DB;
let close: () => void;
let bus: EventBus;
let mockClient: MockClient;

beforeEach(() => {
  ({ db, close } = createTestDB());
  bus = new EventBus(db);
  mockClient = {
    getUsdtBobPrices: vi.fn(),
    getFees: vi.fn(),
  };
});

afterEach(() => close());

function makePrices(ask: number, bid: number, totalAsk = 500, totalBid = 400) {
  return [{ platform: 'bybitp2p', ask, bid, totalAsk, totalBid, time: Math.floor(Date.now() / 1000) }];
}

describe('Gap Guard', () => {
  it('emits price:gap-alert when price jumps after a gap exceeding the volatility window', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      gapGuardEnabled: true,
      gapGuardThresholdPercent: 2,
    });

    const gapHandler = vi.fn();
    bus.on('price:gap-alert', gapHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();
    expect(gapHandler).not.toHaveBeenCalled();

    const baseTime = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 6 * 60 * 1000);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.30, 7.27));
    await monitor.fetchOnce();

    expect(gapHandler).toHaveBeenCalledTimes(1);
    expect(gapHandler).toHaveBeenCalledWith(expect.objectContaining({
      lastKnownPrice: 6.89,
      resumePrice: 7.27,
    }));
    expect(gapHandler.mock.calls[0][0].changePercent).toBeGreaterThan(5);

    vi.restoreAllMocks();
  });

  it('does not emit gap alert when gap is within volatility window', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      gapGuardEnabled: true,
      gapGuardThresholdPercent: 2,
    });

    const gapHandler = vi.fn();
    bus.on('price:gap-alert', gapHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();

    const baseTime = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 2 * 60 * 1000);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.30, 7.27));
    await monitor.fetchOnce();

    expect(gapHandler).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('does not emit gap alert when disabled', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      gapGuardEnabled: false,
      gapGuardThresholdPercent: 2,
    });

    const gapHandler = vi.fn();
    bus.on('price:gap-alert', gapHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();

    const baseTime = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 6 * 60 * 1000);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.30, 7.27));
    await monitor.fetchOnce();

    expect(gapHandler).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('Depth Guard', () => {
  it('emits price:low-depth when totalAsk is below minimum', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      depthGuardEnabled: true,
      depthGuardMinUsdt: 100,
    });

    const depthHandler = vi.fn();
    bus.on('price:low-depth', depthHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89, 50, 400));
    await monitor.fetchOnce();

    expect(depthHandler).toHaveBeenCalledTimes(1);
    expect(depthHandler).toHaveBeenCalledWith(expect.objectContaining({
      totalAsk: 50,
      totalBid: 400,
      minRequired: 100,
    }));
  });

  it('emits price:low-depth when totalBid is below minimum', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      depthGuardEnabled: true,
      depthGuardMinUsdt: 100,
    });

    const depthHandler = vi.fn();
    bus.on('price:low-depth', depthHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89, 500, 30));
    await monitor.fetchOnce();

    expect(depthHandler).toHaveBeenCalledTimes(1);
  });

  it('does not emit when depth is sufficient', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      depthGuardEnabled: true,
      depthGuardMinUsdt: 100,
    });

    const depthHandler = vi.fn();
    bus.on('price:low-depth', depthHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89, 500, 400));
    await monitor.fetchOnce();

    expect(depthHandler).not.toHaveBeenCalled();
  });

  it('does not emit when disabled', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      depthGuardEnabled: false,
      depthGuardMinUsdt: 100,
    });

    const depthHandler = vi.fn();
    bus.on('price:low-depth', depthHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89, 50, 30));
    await monitor.fetchOnce();

    expect(depthHandler).not.toHaveBeenCalled();
  });
});

describe('Session Drift Guard', () => {
  it('emits price:session-drift when price drifts beyond threshold', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      sessionDriftGuardEnabled: true,
      sessionDriftThresholdPercent: 3,
    });

    const driftHandler = vi.fn();
    bus.on('price:session-drift', driftHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();
    expect(driftHandler).not.toHaveBeenCalled();

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.20, 7.17));
    await monitor.fetchOnce();

    expect(driftHandler).toHaveBeenCalledTimes(1);
    expect(driftHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionBasePrice: 6.89,
      currentPrice: 7.17,
    }));
    expect(driftHandler.mock.calls[0][0].driftPercent).toBeGreaterThan(3);
  });

  it('does not emit when drift is within threshold', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      sessionDriftGuardEnabled: true,
      sessionDriftThresholdPercent: 3,
    });

    const driftHandler = vi.fn();
    bus.on('price:session-drift', driftHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.99, 6.96));
    await monitor.fetchOnce();

    expect(driftHandler).not.toHaveBeenCalled();
  });

  it('resets session base price on emergency:resolved', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      sessionDriftGuardEnabled: true,
      sessionDriftThresholdPercent: 3,
    });

    const driftHandler = vi.fn();
    bus.on('price:session-drift', driftHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();

    await bus.emit('emergency:resolved', { resumedBy: 'test' }, 'test');

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.20, 7.17));
    await monitor.fetchOnce();

    expect(driftHandler).not.toHaveBeenCalled();

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.50, 7.46));
    await monitor.fetchOnce();

    expect(driftHandler).toHaveBeenCalledTimes(1);
    expect(driftHandler.mock.calls[0][0].sessionBasePrice).toBeCloseTo(7.17, 1);
  });

  it('does not emit when disabled', async () => {
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      sessionDriftGuardEnabled: false,
      sessionDriftThresholdPercent: 3,
    });

    const driftHandler = vi.fn();
    bus.on('price:session-drift', driftHandler);

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(6.92, 6.89));
    await monitor.fetchOnce();

    mockClient.getUsdtBobPrices.mockResolvedValueOnce(makePrices(7.20, 7.17));
    await monitor.fetchOnce();

    expect(driftHandler).not.toHaveBeenCalled();
  });
});
