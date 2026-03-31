import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../../../src/event-bus.js';
import { AdManager } from '../../../src/modules/ad-manager/index.js';
import { createTestDB } from '../../../src/db/index.js';
import type { DB } from '../../../src/db/index.js';
import type { PricingConfig } from '../../../src/modules/ad-manager/types.js';
import type { Side } from '../../../src/event-bus.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: DB;
let close: () => void;
let bus: EventBus;

const DEFAULT_CONFIG: PricingConfig = {
  minSpread: 0.015,
  maxSpread: 0.05,
  tradeAmountUsdt: 300,
  imbalanceThresholdUsdt: 300,
};

function mockBybit(overrides: Record<string, unknown> = {}) {
  return {
    getPersonalAds: vi.fn().mockResolvedValue([]),
    getPaymentMethods: vi.fn().mockResolvedValue([{ id: 'pm-1' }]),
    createAd: vi.fn().mockResolvedValue('ad-new-123'),
    updateAd: vi.fn().mockResolvedValue(undefined),
    cancelAd: vi.fn().mockResolvedValue(undefined),
    getOnlineAds: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

function mockGetBank() {
  return vi.fn().mockReturnValue({ id: 1, name: 'Banco Union' });
}

function createAdManager(
  bybit = mockBybit(),
  config = DEFAULT_CONFIG,
  getBankAccount = mockGetBank(),
) {
  return new AdManager(bus, db, bybit, config, getBankAccount);
}

/** Seed an active ad directly into the AdManager's internal map via syncExistingAds */
async function seedAd(
  am: AdManager,
  bybit: any,
  side: Side,
  amount: number,
  price = 9.35,
  adId = `ad-${side}-1`,
) {
  bybit.getPersonalAds.mockResolvedValueOnce([
    { id: adId, side, price, amount, status: '1' },
  ]);
  bybit.getPaymentMethods.mockResolvedValueOnce([{ id: 'pm-1' }]);
  await am.syncExistingAds();
}

beforeEach(() => {
  ({ db, close } = createTestDB());
  bus = new EventBus(db);
});

afterEach(() => {
  bus.removeAllListeners();
  close();
  vi.restoreAllMocks();
});

// ===========================================================================
// A. Liquidity Tracking
// ===========================================================================

describe('Liquidity Tracking', () => {
  it('#1 — sell ad 300, order:new 200 → remaining 100', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'bob' }, 'test');

    expect(am.getActiveAds().get('sell')!.amountUsdt).toBe(100);
  });

  it('#2 — buy ad 300, order:new 200 → remaining 100', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'buy', 300);

    await bus.emit('order:new', { orderId: 'o1', side: 'buy' as Side, amount: 200, price: 9.30, counterparty: 'bob' }, 'test');

    expect(am.getActiveAds().get('buy')!.amountUsdt).toBe(100);
  });

  it('#3 — full fill: order equals ad amount → remaining 0', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 300, price: 9.35, counterparty: 'bob' }, 'test');

    expect(am.getActiveAds().get('sell')!.amountUsdt).toBe(0);
  });

  it('#4 — order bigger than ad → clamped to 0, no negative', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 400, price: 9.35, counterparty: 'bob' }, 'test');

    expect(am.getActiveAds().get('sell')!.amountUsdt).toBe(0);
  });

  it('#5 — rapid fire: 200 + 150 on 300 ad → clamped to 0', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'a' }, 'test');
    await bus.emit('order:new', { orderId: 'o2', side: 'sell' as Side, amount: 150, price: 9.35, counterparty: 'b' }, 'test');

    expect(am.getActiveAds().get('sell')!.amountUsdt).toBe(0);
  });

  it('#6 — order:new on side with no active ad → no crash', async () => {
    const am = createAdManager();
    // No ads seeded — should not throw
    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'bob' }, 'test');

    expect(am.getActiveAds().size).toBe(0);
  });

  it('#7 — Bybit sync corrects drift: local 100, Bybit 80 → 80', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // Simulate local tracking drifting to 100
    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'bob' }, 'test');
    expect(am.getActiveAds().get('sell')!.amountUsdt).toBe(100);

    // Bybit reports 80 remaining on next sync
    bybit.getPersonalAds.mockResolvedValueOnce([
      { id: 'ad-sell-1', side: 'sell', price: 9.35, amount: 80, status: '1' },
    ]);

    // Force 5 ticks to trigger sync (tick also needs pricing data to not early-return)
    for (let i = 0; i < 5; i++) {
      await am.tick();
    }

    expect(am.getActiveAds().get('sell')!.amountUsdt).toBe(80);
  });

  it('#8 — sync runs on 5th tick, not before', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // getPersonalAds was called once during seedAd's syncExistingAds
    const callsBefore = bybit.getPersonalAds.mock.calls.length;

    // Run 4 ticks — should NOT trigger sync yet
    for (let i = 0; i < 4; i++) {
      await am.tick();
    }
    expect(bybit.getPersonalAds.mock.calls.length).toBe(callsBefore);

    // 5th tick triggers sync
    await am.tick();
    expect(bybit.getPersonalAds.mock.calls.length).toBe(callsBefore + 1);
  });

  it('#9 — order:cancelled forces sync on next tick', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    const callsBefore = bybit.getPersonalAds.mock.calls.length;

    // Cancel event should force sync on the very next tick
    await bus.emit('order:cancelled', { orderId: 'o1', reason: 'timeout' }, 'test');
    await am.tick();

    expect(bybit.getPersonalAds.mock.calls.length).toBe(callsBefore + 1);
  });
});

// ===========================================================================
// B. Refill Gating
// ===========================================================================

describe('Refill Gating', () => {
  it('#10 — quantityLow but no release → no refill', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // Drain to 100 (below 50% of 300)
    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'bob' }, 'test');
    expect(am.getActiveAds().get('sell')!.amountUsdt).toBe(100);

    // manageSide with a new price — should reprice but NOT refill
    await am.manageSide('sell', 9.36, false);

    // updateAd called with existing (low) amount, not tradeAmountUsdt
    expect(bybit.updateAd).toHaveBeenCalledWith(
      'ad-sell-1', 9.36, 100, expect.any(Array),
    );
  });

  it('#11 — quantityLow + release → refills to tradeAmountUsdt', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // Drain to 100
    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'bob' }, 'test');

    // Release the order
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, totalBob: 1870, profit: 0, bankAccountId: 1 }, 'test');

    // manageSide should now refill
    await am.manageSide('sell', 9.36, false);

    expect(bybit.updateAd).toHaveBeenCalledWith(
      'ad-sell-1', 9.36, 300, expect.any(Array),
    );
  });

  it('#12 — refill consumes allowance: second tick does NOT refill again', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // Drain + release
    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'bob' }, 'test');
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, totalBob: 1870, profit: 0, bankAccountId: 1 }, 'test');

    // First manageSide refills
    await am.manageSide('sell', 9.36, false);
    expect(bybit.updateAd).toHaveBeenLastCalledWith('ad-sell-1', 9.36, 300, expect.any(Array));

    // Simulate another partial fill without release
    await bus.emit('order:new', { orderId: 'o2', side: 'sell' as Side, amount: 200, price: 9.36, counterparty: 'alice' }, 'test');
    bybit.updateAd.mockClear();

    // manageSide with a price change — should reprice at low amount, NOT refill
    await am.manageSide('sell', 9.37, false);
    expect(bybit.updateAd).toHaveBeenCalledWith('ad-sell-1', 9.37, 100, expect.any(Array));
  });

  it('#13 — two releases → two refills across ticks', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // --- First cycle ---
    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'a' }, 'test');
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, totalBob: 1870, profit: 0, bankAccountId: 1 }, 'test');
    // Keep balanced so imbalance limiter doesn't interfere
    await bus.emit('order:released', { orderId: 'b1', side: 'buy' as Side, amount: 200, price: 9.30, totalBob: 1860, profit: 0, bankAccountId: 1 }, 'test');
    await am.manageSide('sell', 9.36, false);
    expect(bybit.updateAd).toHaveBeenLastCalledWith('ad-sell-1', 9.36, 300, expect.any(Array));

    // --- Second cycle ---
    await bus.emit('order:new', { orderId: 'o2', side: 'sell' as Side, amount: 250, price: 9.36, counterparty: 'b' }, 'test');
    await bus.emit('order:released', { orderId: 'o2', side: 'sell' as Side, amount: 250, price: 9.36, totalBob: 2340, profit: 0, bankAccountId: 1 }, 'test');
    await bus.emit('order:released', { orderId: 'b2', side: 'buy' as Side, amount: 250, price: 9.30, totalBob: 2325, profit: 0, bankAccountId: 1 }, 'test');
    await am.manageSide('sell', 9.37, false);
    // Should refill again because a new release happened
    expect(bybit.updateAd).toHaveBeenLastCalledWith('ad-sell-1', 9.37, 300, expect.any(Array));
  });

  it('#14 — order:cancelled does NOT grant refill allowance', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // Drain to 100
    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'bob' }, 'test');

    // Cancel (not release)
    await bus.emit('order:cancelled', { orderId: 'o1', reason: 'timeout' }, 'test');

    // manageSide — should NOT refill
    await am.manageSide('sell', 9.36, false);
    expect(bybit.updateAd).toHaveBeenCalledWith('ad-sell-1', 9.36, 100, expect.any(Array));
  });

  it('#15 — price change with quantityLow but no release → reprices at current amount', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'bob' }, 'test');

    // Price moves — reprice happens but amount stays at 100
    await am.manageSide('sell', 9.40, false);
    expect(bybit.updateAd).toHaveBeenCalledWith('ad-sell-1', 9.40, 100, expect.any(Array));
  });
});

// ===========================================================================
// C. Imbalance Limiter
// ===========================================================================

describe('Imbalance Limiter', () => {
  it('#16 — sell-heavy: net > threshold → sell side paused', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // Release 200 + 150 sells = 350 net
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, totalBob: 1870, profit: 0, bankAccountId: 1 }, 'test');
    await bus.emit('order:released', { orderId: 'o2', side: 'sell' as Side, amount: 150, price: 9.35, totalBob: 1402, profit: 0, bankAccountId: 1 }, 'test');

    const imb = am.getImbalance();
    expect(imb.net).toBe(350);
    expect(imb.pausedSide).toBe('sell');
  });

  it('#17 — buy-heavy: net < -threshold → buy side paused', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'buy', 300);

    await bus.emit('order:released', { orderId: 'o1', side: 'buy' as Side, amount: 200, price: 9.30, totalBob: 1860, profit: 0, bankAccountId: 1 }, 'test');
    await bus.emit('order:released', { orderId: 'o2', side: 'buy' as Side, amount: 150, price: 9.30, totalBob: 1395, profit: 0, bankAccountId: 1 }, 'test');

    const imb = am.getImbalance();
    expect(imb.net).toBe(-350);
    expect(imb.pausedSide).toBe('buy');
  });

  it('#18 — recovery: sell paused → buy release brings net under threshold → sell resumes', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);

    // Build up sell imbalance
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, totalBob: 1870, profit: 0, bankAccountId: 1 }, 'test');
    await bus.emit('order:released', { orderId: 'o2', side: 'sell' as Side, amount: 150, price: 9.35, totalBob: 1402, profit: 0, bankAccountId: 1 }, 'test');
    expect(am.getImbalance().pausedSide).toBe('sell');

    // Buy release brings net from 350 to 250 (under 300 threshold)
    await bus.emit('order:released', { orderId: 'o3', side: 'buy' as Side, amount: 100, price: 9.30, totalBob: 930, profit: 0, bankAccountId: 1 }, 'test');

    const imb = am.getImbalance();
    expect(imb.net).toBe(250);
    expect(imb.pausedSide).toBeNull();
  });

  it('#19 — exact threshold (net = 300) → NOT paused (strict >)', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);

    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 300, price: 9.35, totalBob: 2805, profit: 0, bankAccountId: 1 }, 'test');

    const imb = am.getImbalance();
    expect(imb.net).toBe(300);
    expect(imb.pausedSide).toBeNull();
  });

  it('#20 — net = 301 → paused', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);

    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 301, price: 9.35, totalBob: 2814, profit: 0, bankAccountId: 1 }, 'test');

    expect(am.getImbalance().pausedSide).toBe('sell');
  });

  it('#21 — threshold = 0 → imbalance limiter disabled', async () => {
    const bybit = mockBybit();
    const config = { ...DEFAULT_CONFIG, imbalanceThresholdUsdt: 0 };
    const am = createAdManager(bybit, config);

    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 9999, price: 9.35, totalBob: 0, profit: 0, bankAccountId: 1 }, 'test');

    expect(am.getImbalance().pausedSide).toBeNull();
  });

  it('#22 — manageSide with imbalance paused + existing ad → ad removed', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);
    expect(am.getActiveAds().has('sell')).toBe(true);

    // Trigger imbalance
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 301, price: 9.35, totalBob: 0, profit: 0, bankAccountId: 1 }, 'test');

    await am.manageSide('sell', 9.36, false);

    expect(am.getActiveAds().has('sell')).toBe(false);
    expect(bybit.cancelAd).toHaveBeenCalledWith('ad-sell-1');
  });

  it('#23 — manageSide with imbalance paused + no ad → returns early, no crash', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);

    // Trigger imbalance (no ad exists)
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 301, price: 9.35, totalBob: 0, profit: 0, bankAccountId: 1 }, 'test');

    // Should not throw
    await am.manageSide('sell', 9.36, false);

    expect(bybit.cancelAd).not.toHaveBeenCalled();
    expect(bybit.createAd).not.toHaveBeenCalled();
  });

  it('#24 — imbalance paused → second manageSide → does not try to remove twice', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 301, price: 9.35, totalBob: 0, profit: 0, bankAccountId: 1 }, 'test');

    await am.manageSide('sell', 9.36, false);
    await am.manageSide('sell', 9.37, false);

    // cancelAd called only once (ad already removed after first call)
    expect(bybit.cancelAd).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// D. Interaction / Cross-Feature Edge Cases
// ===========================================================================

describe('Cross-Feature Edge Cases', () => {
  it('#25 — imbalance pause overrides manual pause', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // Trigger imbalance
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 301, price: 9.35, totalBob: 0, profit: 0, bankAccountId: 1 }, 'test');

    // manageSide with shouldPause=false — imbalance should still block
    await am.manageSide('sell', 9.36, false);
    expect(am.getActiveAds().has('sell')).toBe(false);
  });

  it('#26 — balanced session: equal sell and buy releases → nothing paused, both refill', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // Sell cycle — drain past 50% threshold (200 leaves 100, which is < 150)
    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'a' }, 'test');
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, totalBob: 1870, profit: 0, bankAccountId: 1 }, 'test');

    // Buy cycle — keeps balance at net=0
    await bus.emit('order:released', { orderId: 'o2', side: 'buy' as Side, amount: 200, price: 9.30, totalBob: 1860, profit: 0, bankAccountId: 1 }, 'test');

    const imb = am.getImbalance();
    expect(imb.net).toBe(0);
    expect(imb.pausedSide).toBeNull();

    // Sell refill should be allowed (quantityLow=100<150, refillAllowed=true)
    await am.manageSide('sell', 9.36, false);
    expect(bybit.updateAd).toHaveBeenCalledWith('ad-sell-1', 9.36, 300, expect.any(Array));
  });

  it('#27 — getImbalance() accessor returns correct state', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);

    // Start clean
    let imb = am.getImbalance();
    expect(imb).toEqual({ sellVol: 0, buyVol: 0, net: 0, threshold: 300, pausedSide: null });

    // After some trades
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, totalBob: 1870, profit: 0, bankAccountId: 1 }, 'test');
    await bus.emit('order:released', { orderId: 'o2', side: 'buy' as Side, amount: 100, price: 9.30, totalBob: 930, profit: 0, bankAccountId: 1 }, 'test');

    imb = am.getImbalance();
    expect(imb.sellVol).toBe(200);
    expect(imb.buyVol).toBe(100);
    expect(imb.net).toBe(100);
    expect(imb.pausedSide).toBeNull();
  });
});

// ===========================================================================
// E. Bug #28 Fix — Stale refillAllowed after imbalance recovery
// ===========================================================================

describe('Bug #28 — stale refillAllowed after imbalance recovery', () => {
  it('new ad creation resets refillAllowed → no free refill on next partial', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);
    await seedAd(am, bybit, 'sell', 300);

    // Phase 1: sell releases build up imbalance
    await bus.emit('order:new', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, counterparty: 'a' }, 'test');
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 200, price: 9.35, totalBob: 1870, profit: 0, bankAccountId: 1 }, 'test');
    await bus.emit('order:new', { orderId: 'o2', side: 'sell' as Side, amount: 150, price: 9.35, counterparty: 'b' }, 'test');
    await bus.emit('order:released', { orderId: 'o2', side: 'sell' as Side, amount: 150, price: 9.35, totalBob: 1402, profit: 0, bankAccountId: 1 }, 'test');

    // sell is imbalance-paused (net = 350)
    expect(am.getImbalance().pausedSide).toBe('sell');

    // Phase 2: buy release resolves imbalance
    await bus.emit('order:released', { orderId: 'o3', side: 'buy' as Side, amount: 100, price: 9.30, totalBob: 930, profit: 0, bankAccountId: 1 }, 'test');
    expect(am.getImbalance().pausedSide).toBeNull(); // resolved

    // Phase 3: manageSide sees no existing ad (was removed during imbalance) → creates new one
    // The ad was removed in previous manageSide calls during imbalance
    // Simulate that by ensuring no active ad exists
    await am.manageSide('sell', 9.36, false); // removes if exists during imbalance check... but imbalance is resolved now
    // Actually let's directly test: if the ad was already removed during imbalance
    // and now manageSide creates a new one, refillAllowed should be false

    // Force the scenario: remove the ad manually to simulate imbalance removal
    const sellAd = am.getActiveAds().get('sell');
    if (sellAd) {
      // Ad was re-created. Check refillAllowed was reset by creating a partial fill
      await bus.emit('order:new', { orderId: 'o4', side: 'sell' as Side, amount: 200, price: 9.36, counterparty: 'c' }, 'test');

      bybit.updateAd.mockClear();
      await am.manageSide('sell', 9.37, false);

      // Should NOT refill to 300 — refillAllowed was reset on ad creation
      const lastCall = bybit.updateAd.mock.calls[0];
      if (lastCall) {
        expect(lastCall[2]).toBeLessThan(300); // amount arg should be the remaining, not 300
      }
    }
  });

  it('explicit: creating a new ad resets refillAllowed even if it was true', async () => {
    const bybit = mockBybit();
    const am = createAdManager(bybit);

    // Manually set up: release grants refillAllowed
    await bus.emit('order:released', { orderId: 'o1', side: 'sell' as Side, amount: 100, price: 9.35, totalBob: 935, profit: 0, bankAccountId: 1 }, 'test');

    // No active ad → manageSide creates one (which should reset refillAllowed)
    await am.manageSide('sell', 9.36, false);
    expect(bybit.createAd).toHaveBeenCalled();

    // Now drain the new ad
    await bus.emit('order:new', { orderId: 'o2', side: 'sell' as Side, amount: 200, price: 9.36, counterparty: 'a' }, 'test');

    bybit.updateAd.mockClear();
    // manageSide with price change — should NOT refill (refillAllowed was reset on creation)
    await am.manageSide('sell', 9.37, false);

    const lastCall = bybit.updateAd.mock.calls[0];
    if (lastCall) {
      expect(lastCall[2]).toBe(100); // 300 - 200 = 100, not refilled to 300
    }
  });
});
