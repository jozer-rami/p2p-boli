# P2P Chat Relay System — Design Spec

> Status: Implemented
> Date: 2026-03-28
> Depends on: 2026-03-27-p2p-bot-architecture-design.md

---

## 1. Overview

A bidirectional chat relay between Bybit P2P order chats and Telegram. Enables the operator to see counterparty messages (including QR code images) in Telegram and reply without opening the Bybit app.

### Goals

- Poll active order chats on Bybit every 10s, forward new messages to Telegram
- Download and send counterparty images (QR codes) as inline Telegram photos
- Relay Telegram replies back to Bybit P2P chat via reply-to-message detection
- Support photo replies from Telegram → Bybit
- Auto-send QR code + payment instructions on sell orders (already implemented, no changes needed)
- Provide a seed script for bank account setup with QR code paths

### Non-Goals

- OCR / QR code parsing
- Auto-matching bank transfers to orders
- Chat history persistence in our DB (event_log captures events, but not full chat transcripts)

---

## 2. New Module: ChatRelay

New module at `src/modules/chat-relay/`.

### Types (`types.ts`)

```typescript
export interface MonitoredChat {
  orderId: string;
  side: 'buy' | 'sell';
  counterpartyName: string;
  lastSeenMessageTime: number;
  telegramMessageIds: Map<number, string>;  // telegram msg ID → orderId (for reply matching)
}

export interface ChatMessage {
  content: string;
  contentType: string;   // '1' = text, '2' = image
  sendTime: number;
  fromUserId: string;
}
```

### ChatRelay Class (`index.ts`)

**Constructor:** `(bus: EventBus, bybit: BybitClient, telegram: TelegramBot, selfUserId: string)`

- `selfUserId` — the bot operator's Bybit user ID, used to filter out our own messages when polling

**State:**
- `monitoredChats: Map<string, MonitoredChat>` — active chats keyed by orderId
- `intervalId` — polling timer

**Lifecycle:**
- Listens to `order:new` → adds to monitoredChats
- Listens to `order:released`, `order:cancelled`, `order:disputed` → removes from monitoredChats
- Listens to `telegram:chat-reply` → sends reply to Bybit

**Polling (every 10s):**
For each monitored chat:
1. Call `bybit.getOrderMessages(orderId)`
2. Filter messages newer than `lastSeenMessageTime`
3. Filter out messages from self (using `selfUserId`)
4. For each new counterparty message:
   - If text (contentType '1'): call `telegram.sendChatMessage(orderId, counterpartyName, content)` → store returned Telegram message ID
   - If image (contentType '2'): call `telegram.sendChatPhoto(orderId, counterpartyName, content)` → store returned Telegram message ID
5. Update `lastSeenMessageTime`

**Reply handling:**
On `telegram:chat-reply` event:
- If `text` is present: call `bybit.sendOrderMessage(orderId, text)`
- If `photoPath` is present: call `bybit.sendOrderImage(orderId, photoPath)`
- Emit `chat:message-sent`

**Methods:**
- `start(intervalMs: number)` / `stop()`
- `getMonitoredChats()` — returns count for /status command

**Events emitted:**
- `chat:message-received` — `{ orderId: string; from: string; content: string; contentType: string }`
- `chat:message-sent` — `{ orderId: string; content: string }`

---

## 3. Telegram Changes

### New Methods on TelegramBot

```typescript
async sendChatMessage(orderId: string, counterparty: string, text: string): Promise<number>
```
- Sends formatted message: `"💬 Order #${orderId} (${counterparty}):\n${text}"`
- Returns Telegram message ID (for reply tracking)

```typescript
async sendChatPhoto(orderId: string, counterparty: string, photoUrl: string): Promise<number>
```
- Downloads image from `photoUrl` into memory (Buffer)
- Sends as Telegram photo with caption: `"📷 Order #${orderId} (${counterparty})"`
- Returns Telegram message ID

### Reply Detection

In grammY bot setup, add a handler for messages that are replies to forwarded chat messages:

```typescript
bot.on('message', async (ctx) => {
  const reply = ctx.message.reply_to_message;
  if (!reply) return;

  const replyMsgId = reply.message_id;
  const orderId = chatReplyMap.get(replyMsgId);
  if (!orderId) return;  // not a reply to a forwarded chat message

  if (ctx.message.text) {
    bus.emit('telegram:chat-reply', { orderId, text: ctx.message.text }, 'telegram');
  }

  if (ctx.message.photo) {
    // Download photo, save to temp file, emit with path
    const photo = ctx.message.photo[ctx.message.photo.length - 1]; // highest res
    const file = await ctx.api.getFile(photo.file_id);
    const tempPath = `./data/tmp/${file.file_unique_id}.jpg`;
    // download and save...
    bus.emit('telegram:chat-reply', { orderId, photoPath: tempPath }, 'telegram');
  }
});
```

### Chat Reply Map

TelegramBot maintains a `Map<number, string>` (`telegramMessageId → orderId`). ChatRelay calls `sendChatMessage`/`sendChatPhoto` and registers the returned message ID into this map.

The map is managed by ChatRelay (it passes message IDs after sending). TelegramBot exposes:
```typescript
registerChatMessage(telegramMsgId: number, orderId: string): void
```

### New Event in EventMap

```typescript
'telegram:chat-reply': { orderId: string; text?: string; photoPath?: string }
'chat:message-received': { orderId: string; from: string; content: string; contentType: string }
'chat:message-sent': { orderId: string; content: string }
```

---

## 4. Main Wiring (`src/index.ts`)

### Self User ID

The bot needs to know its own Bybit user ID to filter out its own messages from the chat poll. This can be obtained from `bybit.getP2PUserInfo()` on startup, or set as an env var `BYBIT_USER_ID`.

Simpler approach: add `BYBIT_USER_ID` to `.env`. The user can find it in their Bybit account settings.

Fallback: if not set, the first message the bot sends to a chat will reveal its user ID from the response. For v1, use the env var.

### ChatRelay Initialization

```typescript
const chatRelay = new ChatRelay(bus, bybitClient, telegramBot, envConfig.bybit.userId);
```

Added after TelegramBot in the startup sequence, before polling loops start.

### Startup

```typescript
chatRelay.start(10_000); // 10s polling
```

### Shutdown

```typescript
chatRelay.stop();
```

---

## 5. Seed Script

### File: `src/scripts/seed-banks.ts`

A standalone script to insert/upsert bank accounts into the DB.

### Structure

```typescript
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
  // ... more accounts
];
```

### Behavior

- Loads `.env` for DB_PATH
- Creates DB connection using `createDB()`
- For each account: `INSERT ... ON CONFLICT(name) DO UPDATE` (upsert)
- Creates `./data/qr/` directory if missing
- Warns if `qrCodePath` file doesn't exist (doesn't fail)
- Logs each insert/update

### Run

```bash
npm run seed:banks
```

Added to `package.json` scripts: `"seed:banks": "tsx src/scripts/seed-banks.ts"`

---

## 6. Updated File Map

```
New:
  src/modules/chat-relay/
    ├── index.ts          # ChatRelay class (poll, forward, relay)
    └── types.ts          # MonitoredChat, ChatMessage
  src/scripts/seed-banks.ts  # Bank account seeder

Modified:
  src/event-bus.ts         # Add chat:message-received, chat:message-sent, telegram:chat-reply
  src/modules/telegram/index.ts  # sendChatMessage, sendChatPhoto, reply detection, registerChatMessage
  src/index.ts             # Wire ChatRelay, add BYBIT_USER_ID config
  src/config.ts            # Add BYBIT_USER_ID env var (optional)
  .env.example             # Add BYBIT_USER_ID
  package.json             # Add seed:banks script

Tests:
  tests/modules/chat-relay/index.test.ts  # ChatRelay tests
```

---

## 7. API Budget

| Module | Interval | Calls per interval | Notes |
|--------|----------|-------------------|-------|
| OrderHandler | 5s | 1-2 | getPendingOrders + detail |
| AdManager | 30s | 0-3 | getOnlineAds + update 2 ads |
| PriceMonitor | 60s | 1 | CriptoYa (not Bybit) |
| **ChatRelay** | **10s** | **1 per active order** | getOrderMessages |

Worst case with 3 concurrent orders: ~8 calls per 5s window. Bybit limit is 10 req/s — comfortable.

---

## 8. Complete Buy/Sell Chat Flows

### Sell Order (you sell USDT, receive BOB)

```
1. Counterparty accepts your sell ad
2. OrderHandler emits order:new (side=sell)
3. index.ts auto-sends YOUR QR code + payment message to Bybit chat (existing)
4. ChatRelay starts monitoring this order's chat
5. Counterparty may reply (acknowledgment, questions)
   → ChatRelay forwards to Telegram
   → You can reply via Telegram reply-to-message
6. Counterparty pays via QR, marks paid on Bybit
7. OrderHandler emits order:payment-claimed
8. TelegramBot sends [Confirm & Release] / [Dispute] buttons
9. You check bank → tap [Confirm & Release]
10. OrderHandler releases → ChatRelay stops monitoring
```

### Buy Order (you buy USDT, pay BOB)

```
1. Counterparty accepts your buy ad
2. OrderHandler emits order:new (side=buy)
3. ChatRelay starts monitoring this order's chat
4. Counterparty sends their QR code / bank details in Bybit chat
5. ChatRelay detects new image message
   → Downloads image from Bybit
   → Sends as inline Telegram photo: "📷 Order #123 (trader_bob)"
6. You see QR code in Telegram, scan it with bank app, pay
7. You tap [Mark as Paid] in Telegram
   → OrderHandler calls bybit.markOrderAsPaid()
8. Counterparty verifies payment, releases USDT
9. OrderHandler emits order:released → ChatRelay stops monitoring
```
