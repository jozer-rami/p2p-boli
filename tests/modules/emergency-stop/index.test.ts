import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDB } from '../../../src/db/index.js';
import { EventBus } from '../../../src/event-bus.js';
import { EmergencyStop } from '../../../src/modules/emergency-stop/index.js';
import type { EmergencyDeps } from '../../../src/modules/emergency-stop/index.js';
import type { DB } from '../../../src/db/index.js';

let db: DB;
let close: () => void;
let bus: EventBus;
let deps: EmergencyDeps;
let emergencyStop: EmergencyStop;

beforeEach(() => {
  ({ db, close } = createTestDB());
  bus = new EventBus(db);

  deps = {
    removeAllAds: vi.fn().mockResolvedValue(undefined),
    getExposure: vi.fn().mockResolvedValue({ usdt: 1500, bob: 14000 }),
    getMarketState: vi.fn().mockReturnValue({ ask: 9.45, bid: 9.35 }),
    getPendingOrderCount: vi.fn().mockReturnValue(0),
    stopPolling: vi.fn(),
    startPolling: vi.fn(),
  };

  emergencyStop = new EmergencyStop(bus, db, deps);
});

afterEach(() => {
  bus.removeAllListeners();
  close();
  vi.restoreAllMocks();
});

describe('EmergencyStop', () => {
  it('triggers on price:volatility-alert', async () => {
    const triggered: unknown[] = [];
    bus.on('emergency:triggered', (payload) => {
      triggered.push(payload);
    });

    await bus.emit(
      'price:volatility-alert',
      { currentPrice: 9.65, previousPrice: 9.35, changePercent: 3.21, windowMinutes: 5 },
      'test',
    );

    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalledOnce();
    expect(deps.stopPolling).toHaveBeenCalledOnce();
    expect(triggered).toHaveLength(1);
    const payload = triggered[0] as { trigger: string; marketState: object; exposure: object };
    expect(payload.trigger).toBe('volatility');
    expect(payload.marketState).toEqual({ ask: 9.45, bid: 9.35 });
    expect(payload.exposure).toEqual({ usdt: 1500, bob: 14000 });
  });

  it('triggers on price:stale', async () => {
    const triggered: unknown[] = [];
    bus.on('emergency:triggered', (payload) => {
      triggered.push(payload);
    });

    await bus.emit(
      'price:stale',
      { lastUpdate: Date.now() - 360000, staleDurationSeconds: 360 },
      'test',
    );

    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalledOnce();
    expect(deps.stopPolling).toHaveBeenCalledOnce();
    expect(triggered).toHaveLength(1);
    const payload = triggered[0] as { trigger: string };
    expect(payload.trigger).toBe('stale_data');
  });

  it('triggers on ad:spread-inversion', async () => {
    const triggered: unknown[] = [];
    bus.on('emergency:triggered', (payload) => {
      triggered.push(payload);
    });

    await bus.emit(
      'ad:spread-inversion',
      { buyPrice: 9.50, sellPrice: 9.40 },
      'test',
    );

    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalledOnce();
    expect(deps.stopPolling).toHaveBeenCalledOnce();
    expect(triggered).toHaveLength(1);
    const payload = triggered[0] as { trigger: string };
    expect(payload.trigger).toBe('spread_inversion');
  });

  it('triggers on telegram:emergency', async () => {
    const triggered: unknown[] = [];
    bus.on('emergency:triggered', (payload) => {
      triggered.push(payload);
    });

    await bus.emit('telegram:emergency', {}, 'test');

    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalledOnce();
    expect(deps.stopPolling).toHaveBeenCalledOnce();
    expect(triggered).toHaveLength(1);
    const payload = triggered[0] as { trigger: string };
    expect(payload.trigger).toBe('manual');
  });

  it('does NOT double-trigger when already in emergency', async () => {
    const triggered: unknown[] = [];
    bus.on('emergency:triggered', (payload) => {
      triggered.push(payload);
    });

    // First trigger
    await bus.emit(
      'price:volatility-alert',
      { currentPrice: 9.65, previousPrice: 9.35, changePercent: 3.21, windowMinutes: 5 },
      'test',
    );

    // Second trigger while already in emergency
    await bus.emit('telegram:emergency', {}, 'test');

    expect(triggered).toHaveLength(1);
    expect(deps.removeAllAds).toHaveBeenCalledOnce();
    expect(deps.stopPolling).toHaveBeenCalledOnce();
  });

  it('triggers on price:gap-alert', async () => {
    await bus.emit('price:gap-alert', {
      lastKnownPrice: 6.89,
      resumePrice: 7.27,
      changePercent: 5.5,
      gapDurationSeconds: 360,
    }, 'test');

    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalled();
    expect(deps.stopPolling).toHaveBeenCalled();
  });

  it('triggers on price:low-depth', async () => {
    await bus.emit('price:low-depth', {
      totalAsk: 50,
      totalBid: 30,
      minRequired: 100,
    }, 'test');

    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalled();
  });

  it('triggers on price:session-drift', async () => {
    await bus.emit('price:session-drift', {
      sessionBasePrice: 6.89,
      currentPrice: 7.17,
      driftPercent: 4.1,
    }, 'test');

    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalled();
  });

  it('resolves on resume', async () => {
    const resolved: unknown[] = [];
    bus.on('emergency:resolved', (payload) => {
      resolved.push(payload);
    });

    // First trigger an emergency
    await emergencyStop.trigger('manual', 'test trigger');
    expect(emergencyStop.getState()).toBe('emergency');

    // Then resolve it
    await emergencyStop.resolve('admin');

    expect(emergencyStop.getState()).toBe('running');
    expect(deps.startPolling).toHaveBeenCalledOnce();
    expect(resolved).toHaveLength(1);
    const payload = resolved[0] as { resumedBy: string };
    expect(payload.resumedBy).toBe('admin');
  });
});
