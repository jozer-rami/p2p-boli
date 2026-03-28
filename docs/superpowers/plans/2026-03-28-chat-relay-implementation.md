# P2P Chat Relay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bidirectional chat relay between Bybit P2P order chats and Telegram — forward counterparty messages/images to Telegram, relay replies back to Bybit, plus a bank account seed script.

**Architecture:** New `ChatRelay` module polls Bybit chat every 10s for active orders, forwards text/images to Telegram, tracks message IDs for reply mapping. TelegramBot gets new methods for sending chat messages/photos and detecting reply-to-message. A standalone seed script populates bank accounts.

**Tech Stack:** TypeScript, bybit-api, grammY (InputFile for photos), better-sqlite3/drizzle-orm, pino

**Spec:** `docs/superpowers/specs/2026-03-28-chat-relay-design.md`

---

## File Map

### New files
- `src/modules/chat-relay/types.ts` — MonitoredChat, ChatMessage interfaces
- `src/modules/chat-relay/index.ts` — ChatRelay class (poll, forward, relay)
- `src/scripts/seed-banks.ts` — Bank account seeder script
- `tests/modules/chat-relay/index.test.ts` — ChatRelay tests

### Modified files
- `src/event-bus.ts` — Add 3 new events to EventMap
- `src/config.ts` — Add optional BYBIT_USER_ID env var
- `src/modules/telegram/index.ts` — Add sendChatMessage, sendChatPhoto, registerChatMessage, reply detection
- `src/index.ts` — Wire ChatRelay module, start/stop in lifecycle
- `package.json` — Add seed:banks script

---

## Task 1: Add New Events to EventMap

**Files:**
- Modify: `src/event-bus.ts`

- [ ] **Step 1: Add chat and reply events to EventMap**

In `src/event-bus.ts`, add these three events to the `EventMap` interface, after the existing `telegram:command` entry:

```typescript
  // Chat relay events
  'telegram:chat-reply': { orderId: string; text?: string; photoPath?: string };
  'chat:message-received': { orderId: string; from: string; content: string; contentType: string };
  'chat:message-sent': { orderId: string; content: string };
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run`
Expected: All 59 tests pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/event-bus.ts
git commit -m "feat: add chat relay events to EventMap"
```

---

## Task 2: Add BYBIT_USER_ID to Config

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add optional bybit userId to envConfig**

In `src/config.ts`, add `userId` to the `bybit` section of `envConfig`:

```typescript
export const envConfig = {
  bybit: {
    apiKey: required('BYBIT_API_KEY'),
    apiSecret: required('BYBIT_API_SECRET'),
    testnet: optional('BYBIT_TESTNET', 'true') === 'true',
    userId: optional('BYBIT_USER_ID', ''),
  },
  telegram: {
    botToken: required('TELEGRAM_BOT_TOKEN'),
    chatId: required('TELEGRAM_CHAT_ID'),
  },
  db: {
    path: optional('DB_PATH', './data/bot.db'),
  },
  log: {
    level: optional('LOG_LEVEL', 'info'),
  },
} as const;
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add optional BYBIT_USER_ID to config"
```

---

## Task 3: Extend TelegramBot with Chat Methods

**Files:**
- Modify: `src/modules/telegram/index.ts`

- [ ] **Step 1: Add imports for InputFile and fs/path**

At the top of `src/modules/telegram/index.ts`, update the grammy import and add Node.js imports:

```typescript
import { Bot, InputFile, type InlineKeyboard } from 'grammy';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';
```

- [ ] **Step 2: Add chatReplyMap and registerChatMessage**

Add a private field and public method to the `TelegramBot` class. After the existing private fields (`bus`, `db`, `chatId`, `bot`), add:

```typescript
  /** Maps Telegram message IDs to Bybit order IDs for reply tracking */
  private readonly chatReplyMap: Map<number, string> = new Map();
```

Add this public method after the `stop()` method:

```typescript
  /**
   * Register a Telegram message ID as belonging to a specific order's chat.
   * Used by ChatRelay to enable reply-to-message detection.
   */
  registerChatMessage(telegramMsgId: number, orderId: string): void {
    this.chatReplyMap.set(telegramMsgId, orderId);
  }
```

- [ ] **Step 3: Add sendChatMessage method**

Add after `registerChatMessage`:

```typescript
  /**
   * Send a formatted chat message to Telegram. Returns the Telegram message ID.
   */
  async sendChatMessage(orderId: string, counterparty: string, text: string): Promise<number> {
    try {
      const msg = await this.bot.api.sendMessage(
        this.chatId,
        `💬 Order #${orderId} (${counterparty}):\n${text}`,
      );
      return msg.message_id;
    } catch (err) {
      log.error({ err, orderId }, 'Failed to send chat message to Telegram');
      return 0;
    }
  }
```

- [ ] **Step 4: Add sendChatPhoto method**

Add after `sendChatMessage`:

```typescript
  /**
   * Download an image from a URL and send it as a Telegram photo.
   * Returns the Telegram message ID.
   */
  async sendChatPhoto(orderId: string, counterparty: string, photoUrl: string): Promise<number> {
    try {
      // Fetch image from Bybit URL
      const response = await fetch(photoUrl);
      if (!response.ok) {
        log.error({ orderId, photoUrl, status: response.status }, 'Failed to download chat photo');
        // Fallback: send as link
        return this.sendChatMessage(orderId, counterparty, `[Image] ${photoUrl}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const inputFile = new InputFile(buffer, 'chat-image.jpg');

      const msg = await this.bot.api.sendPhoto(this.chatId, inputFile, {
        caption: `📷 Order #${orderId} (${counterparty})`,
      });
      return msg.message_id;
    } catch (err) {
      log.error({ err, orderId }, 'Failed to send chat photo to Telegram');
      // Fallback: send URL as text
      return this.sendChatMessage(orderId, counterparty, `[Image] ${photoUrl}`);
    }
  }
```

- [ ] **Step 5: Add reply detection handler**

In the `setupCallbackQueries()` method (or add a new `setupReplyHandler()` called from constructor), add a message handler that detects replies to forwarded chat messages. Add this at the end of `setupCallbackQueries()`:

```typescript
    // Reply-to-message detection for chat relay
    this.bot.on('message', async (ctx) => {
      const reply = ctx.message.reply_to_message;
      if (!reply) return;

      // Check if this is a reply to a forwarded chat message
      const orderId = this.chatReplyMap.get(reply.message_id);
      if (!orderId) return;

      // Text reply
      if (ctx.message.text) {
        await this.bus.emit('telegram:chat-reply', { orderId, text: ctx.message.text }, 'TelegramBot');
        return;
      }

      // Photo reply
      if (ctx.message.photo && ctx.message.photo.length > 0) {
        try {
          const photo = ctx.message.photo[ctx.message.photo.length - 1]; // highest resolution
          const file = await ctx.api.getFile(photo.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;

          // Download to temp file
          await mkdir('./data/tmp', { recursive: true });
          const tempPath = join('./data/tmp', `${file.file_unique_id}.jpg`);
          const res = await fetch(fileUrl);
          const buf = Buffer.from(await res.arrayBuffer());
          const { writeFileSync } = await import('fs');
          writeFileSync(tempPath, buf);

          await this.bus.emit('telegram:chat-reply', { orderId, photoPath: tempPath }, 'TelegramBot');
        } catch (err) {
          log.error({ err, orderId }, 'Failed to process photo reply');
        }
        return;
      }
    });
```

- [ ] **Step 6: Verify typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: No errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules/telegram/index.ts
git commit -m "feat: TelegramBot chat methods — sendChatMessage, sendChatPhoto, reply detection"
```

---

## Task 4: ChatRelay Module — Types

**Files:**
- Create: `src/modules/chat-relay/types.ts`

- [ ] **Step 1: Create types file**

Create `src/modules/chat-relay/types.ts`:

```typescript
export interface MonitoredChat {
  orderId: string;
  side: 'buy' | 'sell';
  counterpartyName: string;
  lastSeenMessageTime: number;
}

export interface ChatMessage {
  content: string;
  contentType: string;   // '1' = text, '2' = image
  sendTime: number;
  fromUserId: string;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/chat-relay/types.ts
git commit -m "feat: ChatRelay types — MonitoredChat, ChatMessage"
```

---

## Task 5: ChatRelay Module — Implementation + Tests

**Files:**
- Create: `src/modules/chat-relay/index.ts`
- Create: `tests/modules/chat-relay/index.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/modules/chat-relay/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatRelay } from '../../../src/modules/chat-relay/index.js';
import { EventBus } from '../../../src/event-bus.js';
import { createTestDB } from '../../../src/db/index.js';
import type { DB } from '../../../src/db/index.js';

describe('ChatRelay', () => {
  let db: DB;
  let close: () => void;
  let bus: EventBus;
  let mockBybit: any;
  let mockTelegram: any;
  let relay: ChatRelay;

  beforeEach(() => {
    const testDb = createTestDB();
    db = testDb.db;
    close = testDb.close;
    bus = new EventBus(db);

    mockBybit = {
      getOrderMessages: vi.fn().mockResolvedValue([]),
      sendOrderMessage: vi.fn().mockResolvedValue(undefined),
      sendOrderImage: vi.fn().mockResolvedValue(undefined),
    };

    mockTelegram = {
      sendChatMessage: vi.fn().mockResolvedValue(100),
      sendChatPhoto: vi.fn().mockResolvedValue(101),
      registerChatMessage: vi.fn(),
    };

    relay = new ChatRelay(bus, mockBybit, mockTelegram, 'my-user-id');
  });

  afterEach(() => {
    relay.stop();
    bus.removeAllListeners();
    close();
  });

  it('starts monitoring on order:new', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    expect(relay.getMonitoredCount()).toBe(1);
  });

  it('stops monitoring on order:released', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    await bus.emit('order:released', { orderId: 'ord-1', amount: 500, profit: 10 }, 'test');

    expect(relay.getMonitoredCount()).toBe(0);
  });

  it('stops monitoring on order:cancelled', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    await bus.emit('order:cancelled', { orderId: 'ord-1', reason: 'timeout' }, 'test');

    expect(relay.getMonitoredCount()).toBe(0);
  });

  it('forwards new counterparty text messages to Telegram', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    mockBybit.getOrderMessages.mockResolvedValueOnce([
      { content: 'Hello, here is my QR', contentType: '1', sendTime: 1000, fromUserId: 'counterparty-id' },
    ]);

    await relay.pollOnce();

    expect(mockTelegram.sendChatMessage).toHaveBeenCalledWith('ord-1', 'trader1', 'Hello, here is my QR');
    expect(mockTelegram.registerChatMessage).toHaveBeenCalledWith(100, 'ord-1');
  });

  it('forwards counterparty image messages as photos', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    mockBybit.getOrderMessages.mockResolvedValueOnce([
      { content: 'https://bybit.com/image.jpg', contentType: '2', sendTime: 1000, fromUserId: 'counterparty-id' },
    ]);

    await relay.pollOnce();

    expect(mockTelegram.sendChatPhoto).toHaveBeenCalledWith('ord-1', 'trader1', 'https://bybit.com/image.jpg');
    expect(mockTelegram.registerChatMessage).toHaveBeenCalledWith(101, 'ord-1');
  });

  it('skips own messages (selfUserId filter)', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    mockBybit.getOrderMessages.mockResolvedValueOnce([
      { content: 'My own message', contentType: '1', sendTime: 1000, fromUserId: 'my-user-id' },
    ]);

    await relay.pollOnce();

    expect(mockTelegram.sendChatMessage).not.toHaveBeenCalled();
  });

  it('does not forward already-seen messages', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    const messages = [
      { content: 'First message', contentType: '1', sendTime: 1000, fromUserId: 'counterparty-id' },
    ];

    mockBybit.getOrderMessages.mockResolvedValue(messages);

    await relay.pollOnce();
    expect(mockTelegram.sendChatMessage).toHaveBeenCalledTimes(1);

    // Poll again with same messages
    await relay.pollOnce();
    expect(mockTelegram.sendChatMessage).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it('relays text reply from Telegram to Bybit', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    await bus.emit('telegram:chat-reply', { orderId: 'ord-1', text: 'Payment sent!' }, 'test');

    expect(mockBybit.sendOrderMessage).toHaveBeenCalledWith('ord-1', 'Payment sent!');
  });

  it('relays photo reply from Telegram to Bybit', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    await bus.emit('telegram:chat-reply', { orderId: 'ord-1', photoPath: './data/tmp/photo.jpg' }, 'test');

    expect(mockBybit.sendOrderImage).toHaveBeenCalledWith('ord-1', './data/tmp/photo.jpg');
  });

  it('emits chat:message-received when forwarding', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    const received = vi.fn();
    bus.on('chat:message-received', received);

    mockBybit.getOrderMessages.mockResolvedValueOnce([
      { content: 'Hello', contentType: '1', sendTime: 1000, fromUserId: 'counterparty-id' },
    ]);

    await relay.pollOnce();

    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'ord-1', from: 'trader1', content: 'Hello', contentType: '1' }),
    );
  });

  it('emits chat:message-sent when relaying reply', async () => {
    await bus.emit('order:new', {
      orderId: 'ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'trader1',
    }, 'test');

    const sent = vi.fn();
    bus.on('chat:message-sent', sent);

    await bus.emit('telegram:chat-reply', { orderId: 'ord-1', text: 'OK' }, 'test');

    expect(sent).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'ord-1', content: 'OK' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/chat-relay/index.test.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/chat-relay/index.js'`

- [ ] **Step 3: Implement ChatRelay**

Create `src/modules/chat-relay/index.ts`:

```typescript
import type { EventBus } from '../../event-bus.js';
import type { BybitClient } from '../../bybit/client.js';
import type { TelegramBot } from '../telegram/index.js';
import type { MonitoredChat } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('chat-relay');
const MODULE = 'ChatRelay';

export class ChatRelay {
  private readonly bus: EventBus;
  private readonly bybit: BybitClient;
  private readonly telegram: TelegramBot;
  private readonly selfUserId: string;
  private readonly monitoredChats: Map<string, MonitoredChat> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(bus: EventBus, bybit: BybitClient, telegram: TelegramBot, selfUserId: string) {
    this.bus = bus;
    this.bybit = bybit;
    this.telegram = telegram;
    this.selfUserId = selfUserId;

    // Start monitoring when a new order appears
    this.bus.on('order:new', (payload) => {
      this.monitoredChats.set(payload.orderId, {
        orderId: payload.orderId,
        side: payload.side,
        counterpartyName: payload.counterparty,
        lastSeenMessageTime: 0,
      });
      log.info({ orderId: payload.orderId, side: payload.side }, 'Started monitoring chat');
    });

    // Stop monitoring when order ends
    const stopMonitoring = (payload: { orderId: string }) => {
      if (this.monitoredChats.delete(payload.orderId)) {
        log.info({ orderId: payload.orderId }, 'Stopped monitoring chat');
      }
    };
    this.bus.on('order:released', stopMonitoring);
    this.bus.on('order:cancelled', stopMonitoring);
    this.bus.on('order:disputed', stopMonitoring);

    // Handle replies from Telegram
    this.bus.on('telegram:chat-reply', async (payload) => {
      if (!this.monitoredChats.has(payload.orderId)) {
        log.warn({ orderId: payload.orderId }, 'Chat reply for unmonitored order');
        return;
      }

      try {
        if (payload.text) {
          await this.bybit.sendOrderMessage(payload.orderId, payload.text);
          await this.bus.emit('chat:message-sent', { orderId: payload.orderId, content: payload.text }, MODULE);
          log.info({ orderId: payload.orderId }, 'Text reply sent to Bybit');
        }

        if (payload.photoPath) {
          await this.bybit.sendOrderImage(payload.orderId, payload.photoPath);
          await this.bus.emit('chat:message-sent', { orderId: payload.orderId, content: '[photo]' }, MODULE);
          log.info({ orderId: payload.orderId }, 'Photo reply sent to Bybit');
        }
      } catch (err) {
        log.error({ err, orderId: payload.orderId }, 'Failed to relay reply to Bybit');
      }
    });
  }

  /**
   * Single polling iteration — check all monitored chats for new messages.
   */
  async pollOnce(): Promise<void> {
    for (const [orderId, chat] of this.monitoredChats) {
      try {
        const messages = await this.bybit.getOrderMessages(orderId);

        // Filter: newer than last seen, not from self
        const newMessages = messages.filter(
          (msg) => msg.sendTime > chat.lastSeenMessageTime && msg.fromUserId !== this.selfUserId,
        );

        for (const msg of newMessages) {
          if (msg.contentType === '2' || msg.content.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)/i)) {
            // Image message
            const telegramMsgId = await this.telegram.sendChatPhoto(orderId, chat.counterpartyName, msg.content);
            if (telegramMsgId) {
              this.telegram.registerChatMessage(telegramMsgId, orderId);
            }
          } else {
            // Text message
            const telegramMsgId = await this.telegram.sendChatMessage(orderId, chat.counterpartyName, msg.content);
            if (telegramMsgId) {
              this.telegram.registerChatMessage(telegramMsgId, orderId);
            }
          }

          await this.bus.emit('chat:message-received', {
            orderId,
            from: chat.counterpartyName,
            content: msg.content,
            contentType: msg.contentType,
          }, MODULE);
        }

        // Update last seen time
        if (newMessages.length > 0) {
          chat.lastSeenMessageTime = Math.max(...newMessages.map((m) => m.sendTime));
        }
      } catch (err) {
        log.error({ err, orderId }, 'Failed to poll chat messages');
      }
    }
  }

  start(intervalMs: number): void {
    log.info({ intervalMs }, 'Starting chat relay');
    this.intervalId = setInterval(() => void this.pollOnce(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    log.info('Chat relay stopped');
  }

  getMonitoredCount(): number {
    return this.monitoredChats.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/chat-relay/index.test.ts`
Expected: 10 tests PASS.

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: All tests pass (59 existing + 10 new = 69).

- [ ] **Step 6: Commit**

```bash
git add src/modules/chat-relay/ tests/modules/chat-relay/
git commit -m "feat: ChatRelay module — bidirectional Bybit P2P chat ↔ Telegram relay"
```

---

## Task 6: Wire ChatRelay into Main Entry Point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add import**

At the top of `src/index.ts`, add after the EmergencyStop import:

```typescript
import { ChatRelay } from './modules/chat-relay/index.js';
```

- [ ] **Step 2: Initialize ChatRelay**

After the `telegramBot` initialization (after the `new TelegramBot(...)` call) and before the QR auto-send event handler, add:

```typescript
// ---------------------------------------------------------------------------
// Chat relay (bidirectional Bybit ↔ Telegram chat)
// ---------------------------------------------------------------------------

const chatRelay = new ChatRelay(bus, bybitClient, telegramBot, envConfig.bybit.userId);
```

- [ ] **Step 3: Start ChatRelay in startup sequence**

In the `start()` function, after `adManager.start(pollIntervalAdsMs);`, add:

```typescript
  chatRelay.start(10_000); // 10s chat polling
```

- [ ] **Step 4: Stop ChatRelay in shutdown**

In the `shutdown()` function, after `stopPolling();`, add:

```typescript
  chatRelay.stop();
```

- [ ] **Step 5: Add chat count to /status command**

In the CommandDeps `getStatus` callback, add `monitoredChats` to the returned object. Find the `getStatus` callback and add:

```typescript
monitoredChats: chatRelay.getMonitoredCount(),
```

This may require updating the `CommandDeps` interface and the `/status` command handler to display the count. If so, add it to the status output string.

- [ ] **Step 6: Verify typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: No errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire ChatRelay into main entry point with 10s polling"
```

---

## Task 7: Seed Script for Bank Accounts

**Files:**
- Create: `src/scripts/seed-banks.ts`
- Modify: `package.json`

- [ ] **Step 1: Create seed script**

Create `src/scripts/seed-banks.ts`:

```typescript
import 'dotenv/config';
import { existsSync, mkdirSync } from 'fs';
import { createDB, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('seed-banks');

// ---------------------------------------------------------------------------
// Edit this array with your bank accounts
// ---------------------------------------------------------------------------

const BANK_ACCOUNTS = [
  {
    name: 'Banco Union Personal',
    bank: 'banco-union',
    accountHint: '4521',
    balanceBob: 15000,
    dailyLimit: 50000,
    priority: 10,
    qrCodePath: './data/qr/banco-union-4521.png',
    paymentMessage: 'Escanea el QR para pagar. Banco Union cuenta ****4521',
  },
  // Add more accounts here:
  // {
  //   name: 'BNB Personal',
  //   bank: 'bnb',
  //   accountHint: '7890',
  //   balanceBob: 10000,
  //   dailyLimit: 40000,
  //   priority: 5,
  //   qrCodePath: './data/qr/bnb-7890.png',
  //   paymentMessage: 'Pagar a BNB cuenta ****7890',
  // },
];

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

const dbPath = process.env.DB_PATH || './data/bot.db';

// Ensure data directories exist
mkdirSync('./data/qr', { recursive: true });
mkdirSync('./data/tmp', { recursive: true });

const db = createDB(dbPath);

for (const account of BANK_ACCOUNTS) {
  // Warn if QR code file is missing
  if (account.qrCodePath && !existsSync(account.qrCodePath)) {
    log.warn({ path: account.qrCodePath, name: account.name }, 'QR code file not found — add it before going live');
  }

  // Upsert: insert or update by name
  const existing = db
    .select()
    .from(schema.bankAccounts)
    .where(eq(schema.bankAccounts.name, account.name))
    .get();

  if (existing) {
    db.update(schema.bankAccounts)
      .set({
        bank: account.bank,
        accountHint: account.accountHint,
        balanceBob: account.balanceBob,
        dailyLimit: account.dailyLimit,
        priority: account.priority,
        qrCodePath: account.qrCodePath,
        paymentMessage: account.paymentMessage,
      })
      .where(eq(schema.bankAccounts.name, account.name))
      .run();
    log.info({ name: account.name }, 'Updated existing bank account');
  } else {
    db.insert(schema.bankAccounts)
      .values({
        name: account.name,
        bank: account.bank,
        accountHint: account.accountHint,
        balanceBob: account.balanceBob,
        dailyLimit: account.dailyLimit,
        priority: account.priority,
        qrCodePath: account.qrCodePath,
        paymentMessage: account.paymentMessage,
      })
      .run();
    log.info({ name: account.name }, 'Inserted new bank account');
  }
}

// Print summary
const allAccounts = db.select().from(schema.bankAccounts).all();
log.info({ count: allAccounts.length }, 'Bank accounts in database:');
for (const acct of allAccounts) {
  const qrStatus = acct.qrCodePath && existsSync(acct.qrCodePath) ? '✓ QR' : '✗ no QR';
  log.info(
    { id: acct.id, name: acct.name, bank: acct.bank, balance: acct.balanceBob, qrStatus },
    `  ${acct.name}`,
  );
}
```

- [ ] **Step 2: Add npm script**

In `package.json`, add to the `scripts` section:

```json
"seed:banks": "tsx src/scripts/seed-banks.ts"
```

- [ ] **Step 3: Verify script runs**

Run: `npm run seed:banks`
Expected: Script runs, logs "Inserted new bank account" for each entry, prints summary. May warn about missing QR code files.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/seed-banks.ts package.json
git commit -m "feat: bank account seed script with QR code path support"
```

---

## Task 8: Integration Smoke Test

**Files:**
- Modify: `tests/smoke.test.ts`

- [ ] **Step 1: Add chat relay smoke test**

Add a new test to the existing `tests/smoke.test.ts`:

```typescript
import { ChatRelay } from '../src/modules/chat-relay/index.js';

// Add inside the existing describe block:

  it('chat relay forwards counterparty messages and handles replies', async () => {
    const mockBybit = {
      getOrderMessages: vi.fn().mockResolvedValue([
        { content: 'Please pay here', contentType: '1', sendTime: 1000, fromUserId: 'counterparty-123' },
      ]),
      sendOrderMessage: vi.fn().mockResolvedValue(undefined),
      sendOrderImage: vi.fn().mockResolvedValue(undefined),
    };

    const mockTelegram = {
      sendChatMessage: vi.fn().mockResolvedValue(42),
      sendChatPhoto: vi.fn().mockResolvedValue(43),
      registerChatMessage: vi.fn(),
    };

    const relay = new ChatRelay(bus, mockBybit as any, mockTelegram as any, 'self-id');

    // Simulate new order
    await bus.emit('order:new', {
      orderId: 'smoke-ord-1', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'smoke_trader',
    }, 'test');

    expect(relay.getMonitoredCount()).toBe(1);

    // Poll — should forward counterparty message
    await relay.pollOnce();
    expect(mockTelegram.sendChatMessage).toHaveBeenCalledWith('smoke-ord-1', 'smoke_trader', 'Please pay here');
    expect(mockTelegram.registerChatMessage).toHaveBeenCalledWith(42, 'smoke-ord-1');

    // Simulate reply from Telegram
    await bus.emit('telegram:chat-reply', { orderId: 'smoke-ord-1', text: 'Paid!' }, 'test');
    expect(mockBybit.sendOrderMessage).toHaveBeenCalledWith('smoke-ord-1', 'Paid!');

    // Order completes — stop monitoring
    await bus.emit('order:released', { orderId: 'smoke-ord-1', amount: 500, profit: 10 }, 'test');
    expect(relay.getMonitoredCount()).toBe(0);

    relay.stop();
  });
```

- [ ] **Step 2: Run smoke test**

Run: `npx vitest run tests/smoke.test.ts`
Expected: All smoke tests pass (4 existing + 1 new = 5).

- [ ] **Step 3: Run full suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/smoke.test.ts
git commit -m "test: add chat relay integration smoke test"
```
