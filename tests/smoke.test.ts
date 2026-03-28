import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { EventBus } from '../src/event-bus.js';
import { createTestDB, schema } from '../src/db/index.js';
import { PriceMonitor } from '../src/modules/price-monitor/index.js';
import { BankManager } from '../src/modules/bank-manager/index.js';
import { EmergencyStop } from '../src/modules/emergency-stop/index.js';
import { calculatePricing } from '../src/modules/ad-manager/pricing.js';
import type { CriptoYaClient } from '../src/modules/price-monitor/criptoya.js';
import type { EmergencyDeps } from '../src/modules/emergency-stop/index.js';
import type { DB } from '../src/db/index.js';
import type { PlatformPrices } from '../src/event-bus.js';

let db: DB;
let close: () => void;
let bus: EventBus;

beforeEach(() => {
  ({ db, close } = createTestDB());
  bus = new EventBus(db);
});

afterEach(() => {
  bus.removeAllListeners();
  close();
  vi.restoreAllMocks();
});

describe('Smoke Tests — End-to-End Event Flow', () => {
  it('price update flows through to pricing calculation', async () => {
    // Create mock CriptoYa client returning prices for bybitp2p and binancep2p
    const mockPrices: PlatformPrices[] = [
      { platform: 'bybitp2p', ask: 9.50, totalAsk: 1000, bid: 9.40, totalBid: 2000, time: Date.now() },
      { platform: 'binancep2p', ask: 9.52, totalAsk: 800, bid: 9.38, totalBid: 1500, time: Date.now() },
    ];

    const mockClient = {
      getUsdtBobPrices: vi.fn().mockResolvedValue(mockPrices),
      getFees: vi.fn(),
    } as unknown as CriptoYaClient;

    const monitor = new PriceMonitor(bus, db, mockClient);

    // Listen for price:updated event
    let receivedPrices: PlatformPrices[] | null = null;
    bus.on('price:updated', (payload) => {
      receivedPrices = payload.prices;
    });

    // Call fetchOnce()
    await monitor.fetchOnce();

    // Verify prices received
    expect(receivedPrices).not.toBeNull();
    expect(receivedPrices).toHaveLength(2);
    expect((receivedPrices as PlatformPrices[])[0].platform).toBe('bybitp2p');

    // Feed those prices into calculatePricing()
    const pricingResult = calculatePricing(receivedPrices as PlatformPrices[], {
      minSpread: 0.05,
      maxSpread: 0.30,
      tradeAmountUsdt: 500,
    });

    // Verify pricing result is valid: buy < sell, not paused
    expect(pricingResult.buyPrice).toBeGreaterThan(0);
    expect(pricingResult.sellPrice).toBeGreaterThan(0);
    expect(pricingResult.buyPrice).toBeLessThan(pricingResult.sellPrice);
    expect(pricingResult.paused.buy).toBe(false);
    expect(pricingResult.paused.sell).toBe(false);
  });

  it('bank manager selects account and tracks balance', async () => {
    // Seed a bank account in DB
    db.insert(schema.bankAccounts).values({
      name: 'Banco Mercantil',
      bank: 'banco-mercantil',
      accountHint: '7823',
      balanceBob: 10000,
      dailyVolume: 0,
      dailyLimit: 50000,
      monthlyVolume: 0,
      status: 'active',
      priority: 5,
      updatedAt: String(Date.now()),
    }).run();

    // Create BankManager, load accounts
    const manager = new BankManager(db, bus);
    await manager.loadAccounts();

    const accounts = manager.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balanceBob).toBe(10000);

    // Select account for a buy trade
    const selected = manager.selectAccount({ minBalance: 5000, side: 'buy' });
    expect(selected).not.toBeNull();
    expect(selected!.name).toBe('Banco Mercantil');

    const accountId = selected!.id;
    const initialBalance = selected!.balanceBob;

    // Update balance after trade (-4675 BOB)
    await manager.updateBalanceAfterTrade(accountId, -4675);

    // Verify balance decreased
    const updated = manager.getAccountById(accountId);
    expect(updated).not.toBeUndefined();
    expect(updated!.balanceBob).toBe(initialBalance - 4675);
    expect(updated!.balanceBob).toBeLessThan(initialBalance);
  });

  it('emergency stop halts on volatility', async () => {
    // Create EmergencyStop with mock deps
    const deps: EmergencyDeps = {
      removeAllAds: vi.fn().mockResolvedValue(undefined),
      getExposure: vi.fn().mockResolvedValue({ usdt: 2000, bob: 19000 }),
      getMarketState: vi.fn().mockReturnValue({ ask: 9.55, bid: 9.45 }),
      getPendingOrderCount: vi.fn().mockReturnValue(0),
      stopPolling: vi.fn(),
      startPolling: vi.fn(),
    };

    const emergencyStop = new EmergencyStop(bus, db, deps);

    // Listen for emergency:triggered
    const triggeredEvents: unknown[] = [];
    bus.on('emergency:triggered', (payload) => {
      triggeredEvents.push(payload);
    });

    // Emit price:volatility-alert through the bus
    await bus.emit(
      'price:volatility-alert',
      { currentPrice: 9.75, previousPrice: 9.45, changePercent: 3.17, windowMinutes: 5 },
      'PriceMonitor',
    );

    // Verify triggered, state is emergency, removeAllAds was called
    expect(triggeredEvents).toHaveLength(1);
    expect(emergencyStop.getState()).toBe('emergency');
    expect(deps.removeAllAds).toHaveBeenCalledOnce();
    expect(deps.stopPolling).toHaveBeenCalledOnce();

    const triggeredPayload = triggeredEvents[0] as {
      trigger: string;
      marketState: { ask: number; bid: number };
      exposure: { usdt: number; bob: number };
    };
    expect(triggeredPayload.trigger).toBe('volatility');
    expect(triggeredPayload.marketState).toEqual({ ask: 9.55, bid: 9.45 });
    expect(triggeredPayload.exposure).toEqual({ usdt: 2000, bob: 19000 });

    // Call resolve, verify state is back to running
    await emergencyStop.resolve('admin');
    expect(emergencyStop.getState()).toBe('running');
    expect(deps.startPolling).toHaveBeenCalledOnce();
  });

  it('events are persisted to event_log', async () => {
    // Emit an order:new event through the bus
    const orderPayload = {
      orderId: 'ORD-SMOKE-001',
      side: 'buy' as const,
      amount: 500,
      price: 9.45,
      counterparty: 'trader_xyz',
    };

    await bus.emit('order:new', orderPayload, 'OrderHandler');

    // Query event_log table
    const rows = await db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.eventType, 'order:new'));

    // Verify the event was persisted with correct type and payload
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('order:new');
    expect(rows[0].module).toBe('OrderHandler');

    const stored = JSON.parse(rows[0].payload ?? '{}');
    expect(stored.orderId).toBe('ORD-SMOKE-001');
    expect(stored.side).toBe('buy');
    expect(stored.amount).toBe(500);
    expect(stored.price).toBe(9.45);
    expect(stored.counterparty).toBe('trader_xyz');
  });
});
