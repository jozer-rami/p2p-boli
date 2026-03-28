import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDB } from '../../../src/db/index.js';
import { EventBus } from '../../../src/event-bus.js';
import { ChatRelay } from '../../../src/modules/chat-relay/index.js';
import type { DB } from '../../../src/db/index.js';

let db: DB;
let close: () => void;
let bus: EventBus;

const mockBybit = {
  getOrderMessages: vi.fn(),
  sendOrderMessage: vi.fn(),
  sendOrderImage: vi.fn(),
};

const mockTelegram = {
  sendChatMessage: vi.fn().mockResolvedValue(100),
  sendChatPhoto: vi.fn().mockResolvedValue(101),
  registerChatMessage: vi.fn(),
};

let relay: ChatRelay;

beforeEach(() => {
  ({ db, close } = createTestDB());
  bus = new EventBus(db);
  vi.clearAllMocks();
  mockTelegram.sendChatMessage.mockResolvedValue(100);
  mockTelegram.sendChatPhoto.mockResolvedValue(101);
  mockBybit.getOrderMessages.mockResolvedValue([]);
  relay = new ChatRelay(bus, mockBybit as any, mockTelegram as any, 'my-user-id');
});

afterEach(() => {
  relay.stop();
  bus.removeAllListeners();
  close();
  vi.restoreAllMocks();
});

describe('ChatRelay', () => {
  it('starts monitoring on order:new', async () => {
    expect(relay.getMonitoredCount()).toBe(0);

    await bus.emit(
      'order:new',
      { orderId: 'ORD-001', side: 'buy', amount: 100, price: 7.0, counterparty: 'alice' },
      'test',
    );

    expect(relay.getMonitoredCount()).toBe(1);
  });

  it('stops monitoring on order:released', async () => {
    await bus.emit(
      'order:new',
      { orderId: 'ORD-002', side: 'sell', amount: 50, price: 7.1, counterparty: 'bob' },
      'test',
    );
    expect(relay.getMonitoredCount()).toBe(1);

    await bus.emit(
      'order:released',
      { orderId: 'ORD-002', amount: 50, profit: 1.5 },
      'test',
    );
    expect(relay.getMonitoredCount()).toBe(0);
  });

  it('stops monitoring on order:cancelled', async () => {
    await bus.emit(
      'order:new',
      { orderId: 'ORD-003', side: 'buy', amount: 80, price: 6.9, counterparty: 'carol' },
      'test',
    );
    expect(relay.getMonitoredCount()).toBe(1);

    await bus.emit(
      'order:cancelled',
      { orderId: 'ORD-003', reason: 'user cancelled' },
      'test',
    );
    expect(relay.getMonitoredCount()).toBe(0);
  });

  it('forwards new counterparty text messages to Telegram', async () => {
    await bus.emit(
      'order:new',
      { orderId: 'ORD-004', side: 'buy', amount: 100, price: 7.0, counterparty: 'dave' },
      'test',
    );

    mockBybit.getOrderMessages.mockResolvedValueOnce([
      { content: 'Hello!', contentType: '1', sendTime: 1000, fromUserId: 'counterparty-id' },
    ]);

    await relay.pollOnce();

    expect(mockTelegram.sendChatMessage).toHaveBeenCalledOnce();
    expect(mockTelegram.sendChatMessage).toHaveBeenCalledWith('ORD-004', 'dave', 'Hello!');
  });

  it('forwards counterparty image messages as photos', async () => {
    await bus.emit(
      'order:new',
      { orderId: 'ORD-005', side: 'sell', amount: 200, price: 7.05, counterparty: 'eve' },
      'test',
    );

    mockBybit.getOrderMessages.mockResolvedValueOnce([
      {
        content: 'https://example.com/receipt.jpg',
        contentType: '2',
        sendTime: 2000,
        fromUserId: 'counterparty-id',
      },
    ]);

    await relay.pollOnce();

    expect(mockTelegram.sendChatPhoto).toHaveBeenCalledOnce();
    expect(mockTelegram.sendChatPhoto).toHaveBeenCalledWith(
      'ORD-005',
      'eve',
      'https://example.com/receipt.jpg',
    );
    expect(mockTelegram.sendChatMessage).not.toHaveBeenCalled();
  });

  it('skips own messages (selfUserId filter)', async () => {
    await bus.emit(
      'order:new',
      { orderId: 'ORD-006', side: 'buy', amount: 100, price: 7.0, counterparty: 'frank' },
      'test',
    );

    mockBybit.getOrderMessages.mockResolvedValueOnce([
      { content: 'My own message', contentType: '1', sendTime: 3000, fromUserId: 'my-user-id' },
    ]);

    await relay.pollOnce();

    expect(mockTelegram.sendChatMessage).not.toHaveBeenCalled();
    expect(mockTelegram.sendChatPhoto).not.toHaveBeenCalled();
  });

  it('does not forward already-seen messages', async () => {
    await bus.emit(
      'order:new',
      { orderId: 'ORD-007', side: 'buy', amount: 100, price: 7.0, counterparty: 'grace' },
      'test',
    );

    const messages = [
      { content: 'First message', contentType: '1', sendTime: 1000, fromUserId: 'counterparty-id' },
    ];
    mockBybit.getOrderMessages.mockResolvedValue(messages);

    // First poll — message forwarded
    await relay.pollOnce();
    expect(mockTelegram.sendChatMessage).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mockBybit.getOrderMessages.mockResolvedValue(messages);

    // Second poll — same message already seen, should not forward again
    await relay.pollOnce();
    expect(mockTelegram.sendChatMessage).not.toHaveBeenCalled();
  });

  it('relays text reply from Telegram to Bybit', async () => {
    await bus.emit(
      'order:new',
      { orderId: 'ORD-008', side: 'buy', amount: 100, price: 7.0, counterparty: 'hank' },
      'test',
    );

    await bus.emit(
      'telegram:chat-reply',
      { orderId: 'ORD-008', text: 'Payment sent!' },
      'test',
    );

    expect(mockBybit.sendOrderMessage).toHaveBeenCalledOnce();
    expect(mockBybit.sendOrderMessage).toHaveBeenCalledWith('ORD-008', 'Payment sent!');
    expect(mockBybit.sendOrderImage).not.toHaveBeenCalled();
  });

  it('relays photo reply from Telegram to Bybit', async () => {
    await bus.emit(
      'order:new',
      { orderId: 'ORD-009', side: 'sell', amount: 150, price: 7.1, counterparty: 'iris' },
      'test',
    );

    await bus.emit(
      'telegram:chat-reply',
      { orderId: 'ORD-009', photoPath: '/tmp/proof.jpg' },
      'test',
    );

    expect(mockBybit.sendOrderImage).toHaveBeenCalledOnce();
    expect(mockBybit.sendOrderImage).toHaveBeenCalledWith('ORD-009', '/tmp/proof.jpg');
    expect(mockBybit.sendOrderMessage).not.toHaveBeenCalled();
  });

  it('emits chat:message-received when forwarding a message', async () => {
    await bus.emit(
      'order:new',
      { orderId: 'ORD-010', side: 'buy', amount: 100, price: 7.0, counterparty: 'jack' },
      'test',
    );

    const received: unknown[] = [];
    bus.on('chat:message-received', (payload) => {
      received.push(payload);
    });

    mockBybit.getOrderMessages.mockResolvedValueOnce([
      { content: 'Check this!', contentType: '1', sendTime: 5000, fromUserId: 'counterparty-id' },
    ]);

    await relay.pollOnce();

    expect(received).toHaveLength(1);
    const payload = received[0] as { orderId: string; from: string; content: string; contentType: string };
    expect(payload.orderId).toBe('ORD-010');
    expect(payload.content).toBe('Check this!');
    expect(payload.contentType).toBe('1');
  });
});
