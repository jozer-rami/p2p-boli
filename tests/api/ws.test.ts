import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketBroadcaster } from '../../src/api/ws.js';

function createMockBus() {
  const handlers = new Map<string, Function>();
  return {
    on: vi.fn((event: string, handler: Function) => { handlers.set(event, handler); }),
    handlers,
  };
}

describe('WebSocketBroadcaster', () => {
  it('broadcasts EventBus events to connected clients', () => {
    const bus = createMockBus();
    const broadcaster = new WebSocketBroadcaster(bus as any);

    const mockClient = { readyState: 1, send: vi.fn() }; // 1 = OPEN
    broadcaster.addClient(mockClient as any);

    const handler = bus.handlers.get('order:new');
    expect(handler).toBeDefined();
    handler!({ orderId: '123', side: 'sell', amount: 150, price: 9.35, counterparty: 'bob' });

    expect(mockClient.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'order:new', payload: { orderId: '123', side: 'sell', amount: 150, price: 9.35, counterparty: 'bob' } })
    );
  });

  it('removes closed clients on broadcast', () => {
    const bus = createMockBus();
    const broadcaster = new WebSocketBroadcaster(bus as any);

    const closedClient = { readyState: 3, send: vi.fn() }; // 3 = CLOSED
    broadcaster.addClient(closedClient as any);

    const handler = bus.handlers.get('order:new');
    handler!({ orderId: '123' });

    expect(closedClient.send).not.toHaveBeenCalled();
    expect(broadcaster.clientCount).toBe(0);
  });

  it('forwards ad:paused events to clients', () => {
    const bus = createMockBus();
    const broadcaster = new WebSocketBroadcaster(bus as any);

    const mockClient = { readyState: 1, send: vi.fn() };
    broadcaster.addClient(mockClient as any);

    const handler = bus.handlers.get('ad:paused');
    expect(handler).toBeDefined();
    handler!({ side: 'sell', reason: 'Imbalance: sold 350 USDT more than bought' });

    expect(mockClient.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'ad:paused', payload: { side: 'sell', reason: 'Imbalance: sold 350 USDT more than bought' } })
    );
  });

  it('forwards reprice:cycle events to clients', () => {
    const bus = createMockBus();
    const broadcaster = new WebSocketBroadcaster(bus as any);

    const mockClient = { readyState: 1, send: vi.fn() };
    broadcaster.addClient(mockClient as any);

    const handler = bus.handlers.get('reprice:cycle');
    expect(handler).toBeDefined();
    handler!({ action: 'reprice', buyPrice: 9.31, sellPrice: 9.35, spread: 0.04 });

    expect(mockClient.send).toHaveBeenCalledWith(
      expect.stringContaining('"event":"reprice:cycle"')
    );
  });
});
