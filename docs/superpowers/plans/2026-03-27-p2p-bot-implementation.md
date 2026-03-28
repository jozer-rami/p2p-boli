# P2P BOB/USDT Market-Making Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated P2P market-making bot on Bybit that posts simultaneous buy/sell USDT/BOB ads, captures the spread, manages bank accounts, and provides full Telegram control.

**Architecture:** Single-process, event-driven Node.js bot. Seven modules communicate via a typed EventBus. SQLite for persistence. Polling loops at configurable intervals. Semi-automated payment verification via Telegram inline buttons.

**Tech Stack:** TypeScript (strict), bybit-api, grammy, drizzle-orm + better-sqlite3, pino, vitest

**Spec:** `docs/superpowers/specs/2026-03-27-p2p-bot-architecture-design.md`

---

## File Map

### Root config files
- `package.json` — dependencies, scripts
- `tsconfig.json` — TypeScript strict mode, path aliases
- `drizzle.config.ts` — Drizzle migration config
- `.env.example` — template for secrets
- `.gitignore` — node_modules, dist, .env, *.db

### Core infrastructure (`src/`)
- `src/config.ts` — env loading + DB config reader
- `src/event-bus.ts` — typed EventEmitter with DB persistence
- `src/index.ts` — entry point, module wiring, startup/shutdown

### Database (`src/db/`)
- `src/db/schema.ts` — all Drizzle table definitions
- `src/db/index.ts` — DB client init + migration runner

### Bybit wrapper (`src/bybit/`)
- `src/bybit/client.ts` — thin wrapper over bybit-api for P2P operations
- `src/bybit/types.ts` — domain type extensions

### Utilities (`src/utils/`)
- `src/utils/logger.ts` — pino logger setup
- `src/utils/retry.ts` — generic retry with exponential backoff

### Modules (`src/modules/`)
- `src/modules/price-monitor/types.ts` — PlatformPrices, SpreadInfo
- `src/modules/price-monitor/criptoya.ts` — CriptoYa HTTP client
- `src/modules/price-monitor/index.ts` — PriceMonitor class

- `src/modules/bank-manager/types.ts` — BankAccount, SelectionCriteria
- `src/modules/bank-manager/selector.ts` — account selection algorithm
- `src/modules/bank-manager/index.ts` — BankManager class

- `src/modules/ad-manager/types.ts` — AdConfig, PricingStrategy
- `src/modules/ad-manager/pricing.ts` — spread calc, bounds enforcement
- `src/modules/ad-manager/index.ts` — AdManager class

- `src/modules/order-handler/types.ts` — OrderState, OrderEvent
- `src/modules/order-handler/lifecycle.ts` — order state machine
- `src/modules/order-handler/index.ts` — OrderHandler class

- `src/modules/emergency-stop/types.ts` — EmergencyTrigger, EmergencyState
- `src/modules/emergency-stop/index.ts` — EmergencyStop class

- `src/modules/telegram/keyboards.ts` — inline keyboard builders
- `src/modules/telegram/alerts.ts` — notification message formatters
- `src/modules/telegram/commands.ts` — command handlers
- `src/modules/telegram/index.ts` — TelegramBot class

### Tests (`tests/`)
- `tests/event-bus.test.ts`
- `tests/db.test.ts`
- `tests/utils/retry.test.ts`
- `tests/modules/price-monitor/criptoya.test.ts`
- `tests/modules/price-monitor/index.test.ts`
- `tests/modules/bank-manager/selector.test.ts`
- `tests/modules/bank-manager/index.test.ts`
- `tests/modules/ad-manager/pricing.test.ts`
- `tests/modules/ad-manager/index.test.ts`
- `tests/modules/order-handler/lifecycle.test.ts`
- `tests/modules/order-handler/index.test.ts`
- `tests/modules/emergency-stop/index.test.ts`
- `tests/modules/telegram/commands.test.ts`
- `tests/modules/telegram/alerts.test.ts`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/joseramirezencinas/Projects/boli
git init
```

- [ ] **Step 2: Create .gitignore**

Create `.gitignore`:

```
node_modules/
dist/
*.db
*.db-journal
.env
.env.local
*.log
```

- [ ] **Step 3: Create package.json**

Create `package.json`:

```json
{
  "name": "boli-p2p-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "bybit-api": "^4.6.1",
    "grammy": "^1.41.1",
    "drizzle-orm": "^0.44.0",
    "better-sqlite3": "^12.0.0",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "dotenv": "^16.5.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.14",
    "@types/node": "^22.15.0",
    "drizzle-kit": "^0.31.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 4: Create tsconfig.json**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "paths": {
      "@/*": ["./src/*"]
    },
    "baseUrl": "."
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create .env.example**

Create `.env.example`:

```bash
# Bybit API
BYBIT_API_KEY=your_api_key
BYBIT_API_SECRET=your_api_secret
BYBIT_TESTNET=true

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Database
DB_PATH=./data/bot.db

# Logging
LOG_LEVEL=info
```

- [ ] **Step 6: Create drizzle.config.ts**

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH || './data/bot.db',
  },
});
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 8: Create folder structure**

```bash
mkdir -p src/{modules/{price-monitor,ad-manager,order-handler,bank-manager,emergency-stop,telegram},db/migrations,bybit,utils}
mkdir -p tests/{modules/{price-monitor,ad-manager,order-handler,bank-manager,emergency-stop,telegram},utils}
mkdir -p data
```

- [ ] **Step 9: Verify TypeScript compiles**

Create a minimal `src/index.ts`:

```typescript
console.log('boli-p2p-bot starting...');
```

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json drizzle.config.ts .env.example src/index.ts
git commit -m "feat: project scaffolding with TypeScript, deps, and folder structure"
```

---

## Task 2: Logger + Retry Utilities

**Files:**
- Create: `src/utils/logger.ts`
- Create: `src/utils/retry.ts`
- Test: `tests/utils/retry.test.ts`

- [ ] **Step 1: Create logger**

Create `src/utils/logger.ts`:

```typescript
import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isProduction
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true } },
});

export function createModuleLogger(module: string) {
  return logger.child({ module });
}
```

- [ ] **Step 2: Write failing test for retry**

Create `tests/utils/retry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/utils/retry.js';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after all retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 10 })
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('auth failed'));
    await expect(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 10,
        shouldRetry: (err) => !err.message.includes('auth'),
      })
    ).rejects.toThrow('auth failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/utils/retry.test.ts`
Expected: FAIL — `Cannot find module '../../src/utils/retry.js'`

- [ ] **Step 4: Implement retry**

Create `src/utils/retry.ts`:

```typescript
import { createModuleLogger } from './logger.js';

const log = createModuleLogger('retry');

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs = 30_000, shouldRetry } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (shouldRetry && !shouldRetry(lastError)) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        log.warn({ attempt: attempt + 1, maxRetries, delay, error: lastError.message }, 'retrying');
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/utils/retry.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/logger.ts src/utils/retry.ts tests/utils/retry.test.ts
git commit -m "feat: add logger (pino) and retry utility with exponential backoff"
```

---

## Task 3: Database Schema + Setup

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`
- Test: `tests/db.test.ts`

- [ ] **Step 1: Write failing test for DB**

Create `tests/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('Database schema', () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema });
    // Create tables directly for testing (no migration files yet)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        bank TEXT NOT NULL,
        account_hint TEXT NOT NULL,
        balance_bob REAL NOT NULL DEFAULT 0,
        daily_volume REAL NOT NULL DEFAULT 0,
        daily_limit REAL NOT NULL DEFAULT 0,
        monthly_volume REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        priority INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bybit_order_id TEXT UNIQUE NOT NULL,
        side TEXT NOT NULL,
        amount_usdt REAL NOT NULL,
        price_bob REAL NOT NULL,
        total_bob REAL NOT NULL,
        spread_captured REAL NOT NULL DEFAULT 0,
        counterparty_id TEXT,
        counterparty_name TEXT,
        bank_account_id INTEGER REFERENCES bank_accounts(id),
        status TEXT NOT NULL DEFAULT 'completed',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER,
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS ads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bybit_ad_id TEXT UNIQUE NOT NULL,
        side TEXT NOT NULL,
        price REAL NOT NULL,
        amount_usdt REAL NOT NULL,
        bank_account_id INTEGER REFERENCES bank_accounts(id),
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS daily_pnl (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        trades_count INTEGER NOT NULL DEFAULT 0,
        volume_usdt REAL NOT NULL DEFAULT 0,
        volume_bob REAL NOT NULL DEFAULT 0,
        profit_bob REAL NOT NULL DEFAULT 0,
        profit_usd REAL NOT NULL DEFAULT 0,
        fees_bob REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
        module TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('inserts and reads config', () => {
    db.insert(schema.config).values({ key: 'min_spread', value: '0.015', updatedAt: Date.now() }).run();
    const row = db.select().from(schema.config).where(eq(schema.config.key, 'min_spread')).get();
    expect(row?.value).toBe('0.015');
  });

  it('inserts and reads bank_accounts', () => {
    db.insert(schema.bankAccounts).values({
      name: 'Banco Union Personal',
      bank: 'banco-union',
      accountHint: '4521',
      balanceBob: 15000,
      dailyLimit: 50000,
      priority: 10,
      updatedAt: Date.now(),
    }).run();
    const rows = db.select().from(schema.bankAccounts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Banco Union Personal');
    expect(rows[0].balanceBob).toBe(15000);
  });

  it('inserts and reads trades', () => {
    db.insert(schema.bankAccounts).values({
      name: 'Test Bank', bank: 'test', accountHint: '0000',
      dailyLimit: 50000, priority: 1, updatedAt: Date.now(),
    }).run();
    db.insert(schema.trades).values({
      bybitOrderId: 'ord-123',
      side: 'sell',
      amountUsdt: 500,
      priceBob: 9.35,
      totalBob: 4675,
      spreadCaptured: 10,
      bankAccountId: 1,
      status: 'completed',
      createdAt: Date.now(),
    }).run();
    const rows = db.select().from(schema.trades).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].side).toBe('sell');
    expect(rows[0].totalBob).toBe(4675);
  });

  it('inserts and reads event_log', () => {
    db.insert(schema.eventLog).values({
      eventType: 'order:new',
      payload: JSON.stringify({ orderId: '123' }),
      timestamp: Date.now(),
      module: 'order-handler',
    }).run();
    const rows = db.select().from(schema.eventLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('order:new');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — `Cannot find module '../src/db/schema.js'`

- [ ] **Step 3: Implement schema**

Create `src/db/schema.ts`:

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const bankAccounts = sqliteTable('bank_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  bank: text('bank').notNull(),
  accountHint: text('account_hint').notNull(),
  balanceBob: real('balance_bob').notNull().default(0),
  dailyVolume: real('daily_volume').notNull().default(0),
  dailyLimit: real('daily_limit').notNull().default(0),
  monthlyVolume: real('monthly_volume').notNull().default(0),
  status: text('status').notNull().default('active'),
  priority: integer('priority').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bybitOrderId: text('bybit_order_id').unique().notNull(),
  side: text('side').notNull(),
  amountUsdt: real('amount_usdt').notNull(),
  priceBob: real('price_bob').notNull(),
  totalBob: real('total_bob').notNull(),
  spreadCaptured: real('spread_captured').notNull().default(0),
  counterpartyId: text('counterparty_id'),
  counterpartyName: text('counterparty_name'),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
  status: text('status').notNull().default('completed'),
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
  metadata: text('metadata'),
});

export const ads = sqliteTable('ads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bybitAdId: text('bybit_ad_id').unique().notNull(),
  side: text('side').notNull(),
  price: real('price').notNull(),
  amountUsdt: real('amount_usdt').notNull(),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const dailyPnl = sqliteTable('daily_pnl', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').unique().notNull(),
  tradesCount: integer('trades_count').notNull().default(0),
  volumeUsdt: real('volume_usdt').notNull().default(0),
  volumeBob: real('volume_bob').notNull().default(0),
  profitBob: real('profit_bob').notNull().default(0),
  profitUsd: real('profit_usd').notNull().default(0),
  feesBob: real('fees_bob').notNull().default(0),
});

export const eventLog = sqliteTable('event_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventType: text('event_type').notNull(),
  payload: text('payload').notNull(),
  timestamp: integer('timestamp').notNull(),
  module: text('module').notNull(),
});
```

- [ ] **Step 4: Implement DB initializer**

Create `src/db/index.ts`:

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { createModuleLogger } from '../utils/logger.js';
import { sql } from 'drizzle-orm';

const log = createModuleLogger('db');

export type DB = ReturnType<typeof drizzle<typeof schema>>;

const TABLE_DEFINITIONS = `
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    bank TEXT NOT NULL,
    account_hint TEXT NOT NULL,
    balance_bob REAL NOT NULL DEFAULT 0,
    daily_volume REAL NOT NULL DEFAULT 0,
    daily_limit REAL NOT NULL DEFAULT 0,
    monthly_volume REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    priority INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bybit_order_id TEXT UNIQUE NOT NULL,
    side TEXT NOT NULL,
    amount_usdt REAL NOT NULL,
    price_bob REAL NOT NULL,
    total_bob REAL NOT NULL,
    spread_captured REAL NOT NULL DEFAULT 0,
    counterparty_id TEXT,
    counterparty_name TEXT,
    bank_account_id INTEGER REFERENCES bank_accounts(id),
    status TEXT NOT NULL DEFAULT 'completed',
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    metadata TEXT
  );
  CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bybit_ad_id TEXT UNIQUE NOT NULL,
    side TEXT NOT NULL,
    price REAL NOT NULL,
    amount_usdt REAL NOT NULL,
    bank_account_id INTEGER REFERENCES bank_accounts(id),
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS daily_pnl (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    trades_count INTEGER NOT NULL DEFAULT 0,
    volume_usdt REAL NOT NULL DEFAULT 0,
    volume_bob REAL NOT NULL DEFAULT 0,
    profit_bob REAL NOT NULL DEFAULT 0,
    profit_usd REAL NOT NULL DEFAULT 0,
    fees_bob REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    module TEXT NOT NULL
  );
`;

export function createDB(dbPath: string): DB {
  log.info({ dbPath }, 'initializing database');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(TABLE_DEFINITIONS);
  return drizzle(sqlite, { schema });
}

export function createTestDB(): { db: DB; close: () => void } {
  const sqlite = new Database(':memory:');
  sqlite.exec(TABLE_DEFINITIONS);
  const db = drizzle(sqlite, { schema });
  return { db, close: () => sqlite.close() };
}

export { schema };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/db.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/index.ts tests/db.test.ts
git commit -m "feat: database schema and setup with SQLite + Drizzle ORM"
```

---

## Task 4: Config Module

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Create config module**

Create `src/config.ts`:

```typescript
import 'dotenv/config';
import { createModuleLogger } from './utils/logger.js';

const log = createModuleLogger('config');

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const envConfig = {
  bybit: {
    apiKey: required('BYBIT_API_KEY'),
    apiSecret: required('BYBIT_API_SECRET'),
    testnet: optional('BYBIT_TESTNET', 'true') === 'true',
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

/** Default config values seeded into the DB config table on first run */
export const DEFAULT_CONFIG = {
  min_spread: '0.015',
  max_spread: '0.05',
  trade_amount_usdt: '500',
  poll_interval_orders_ms: '5000',
  poll_interval_ads_ms: '30000',
  poll_interval_prices_ms: '60000',
  auto_cancel_timeout_ms: '900000',   // 15 minutes
  active_sides: 'both',               // buy | sell | both
  bot_state: 'running',               // running | paused | emergency
  volatility_threshold_percent: '2',
  volatility_window_minutes: '5',
} as const;

export type ConfigKey = keyof typeof DEFAULT_CONFIG;

log.info('config loaded');
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: No errors (may warn about unused — that's fine).

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: config module with env loading and default config values"
```

---

## Task 5: Typed Event Bus

**Files:**
- Create: `src/event-bus.ts`
- Test: `tests/event-bus.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/event-bus.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../src/event-bus.js';
import { createTestDB } from '../src/db/index.js';
import type { DB } from '../src/db/index.js';

describe('EventBus', () => {
  let db: DB;
  let close: () => void;
  let bus: EventBus;

  beforeEach(() => {
    const testDb = createTestDB();
    db = testDb.db;
    close = testDb.close;
    bus = new EventBus(db);
  });

  afterEach(() => {
    bus.removeAllListeners();
    close();
  });

  it('emits and receives typed events', () => {
    const handler = vi.fn();
    bus.on('price:updated', handler);
    const payload = { prices: [], timestamp: Date.now() };
    bus.emit('price:updated', payload, 'price-monitor');
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('persists events to event_log table', () => {
    bus.emit('order:new', {
      orderId: '123', side: 'buy' as const, amount: 500, price: 9.33, counterparty: 'user1',
    }, 'order-handler');

    const rows = db.select().from(require('../src/db/schema.js').eventLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('order:new');
    expect(JSON.parse(rows[0].payload)).toEqual(
      expect.objectContaining({ orderId: '123' })
    );
    expect(rows[0].module).toBe('order-handler');
  });

  it('supports multiple listeners', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('ad:paused', h1);
    bus.on('ad:paused', h2);
    bus.emit('ad:paused', { side: 'buy' as const, reason: 'spread too low' }, 'ad-manager');
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('off removes listener', () => {
    const handler = vi.fn();
    bus.on('price:updated', handler);
    bus.off('price:updated', handler);
    bus.emit('price:updated', { prices: [], timestamp: Date.now() }, 'price-monitor');
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/event-bus.test.ts`
Expected: FAIL — `Cannot find module '../src/event-bus.js'`

- [ ] **Step 3: Implement EventBus**

Create `src/event-bus.ts`:

```typescript
import { eventLog } from './db/schema.js';
import type { DB } from './db/index.js';
import { createModuleLogger } from './utils/logger.js';

const log = createModuleLogger('event-bus');

export type Side = 'buy' | 'sell';

export interface PlatformPrices {
  platform: string;
  ask: number;
  totalAsk: number;
  bid: number;
  totalBid: number;
  time: number;
}

export interface EventMap {
  // Price events
  'price:updated':          { prices: PlatformPrices[]; timestamp: number };
  'price:spread-alert':     { platform: string; spread: number; direction: Side };
  'price:volatility-alert': { currentPrice: number; previousPrice: number; changePercent: number; windowMinutes: number };
  'price:stale':            { lastUpdate: number; staleDurationSeconds: number };

  // Ad events
  'ad:created':             { adId: string; side: Side; price: number; bankAccount: string };
  'ad:repriced':            { adId: string; side: Side; oldPrice: number; newPrice: number };
  'ad:paused':              { side: Side; reason: string };
  'ad:resumed':             { side: Side };
  'ad:spread-inversion':    { buyPrice: number; sellPrice: number };

  // Order events
  'order:new':              { orderId: string; side: Side; amount: number; price: number; counterparty: string };
  'order:payment-claimed':  { orderId: string; amount: number; bankAccount: string };
  'order:released':         { orderId: string; amount: number; profit: number };
  'order:cancelled':        { orderId: string; reason: string };
  'order:disputed':         { orderId: string; reason: string };

  // Bank events
  'bank:low-balance':       { accountId: number; balance: number; threshold: number };
  'bank:daily-limit':       { accountId: number; dailyVolume: number; limit: number };
  'bank:balance-updated':   { accountId: number; newBalance: number };

  // Emergency events
  'emergency:triggered':    { reason: string; trigger: 'volatility' | 'spread_inversion' | 'stale_data' | 'manual'; marketState: { ask: number; bid: number }; exposure: { usdt: number; bob: number } };
  'emergency:resolved':     { resumedBy: string };

  // Telegram events
  'telegram:release':       { orderId: string };
  'telegram:dispute':       { orderId: string };
  'telegram:emergency':     Record<string, never>;
  'telegram:command':       { command: string; args: string[] };
}

type EventHandler<T> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventHandler<any>>>();
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K], module: string): void {
    log.debug({ event, module }, 'event emitted');

    // Persist to event_log
    try {
      this.db.insert(eventLog).values({
        eventType: event,
        payload: JSON.stringify(payload),
        timestamp: Date.now(),
        module,
      }).run();
    } catch (err) {
      log.error({ err, event }, 'failed to persist event');
    }

    // Notify listeners
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          log.error({ err, event, module }, 'event handler threw');
        }
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/event-bus.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/event-bus.ts tests/event-bus.test.ts
git commit -m "feat: typed EventBus with DB persistence and listener management"
```

---

## Task 6: Bybit Client Wrapper

**Files:**
- Create: `src/bybit/types.ts`
- Create: `src/bybit/client.ts`

- [ ] **Step 1: Create domain types**

Create `src/bybit/types.ts`:

```typescript
import type { Side } from '../event-bus.js';

export interface BybitAdParams {
  side: Side;
  price: number;
  amount: number;
  currencyId: string;       // 'USDT'
  fiatCurrencyId: string;   // 'BOB'
  paymentMethodIds: string[];
  remark?: string;
}

export interface BybitAd {
  id: string;
  side: Side;
  price: number;
  amount: number;
  status: string;
}

export interface BybitOrder {
  id: string;
  side: Side;
  amount: number;
  price: number;
  totalBob: number;
  status: string;
  counterpartyId: string;
  counterpartyName: string;
  createdAt: number;
}

export interface BybitBalance {
  coin: string;
  available: number;
  frozen: number;
}
```

- [ ] **Step 2: Create Bybit client wrapper**

Create `src/bybit/client.ts`:

```typescript
import { RestClientV5 } from 'bybit-api';
import { createModuleLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { BybitAdParams, BybitAd, BybitOrder, BybitBalance } from './types.js';
import type { Side } from '../event-bus.js';

const log = createModuleLogger('bybit-client');

const RETRY_OPTIONS = {
  maxRetries: 3,
  baseDelayMs: 1000,
  shouldRetry: (err: Error) => {
    // Don't retry auth errors
    if (err.message.includes('401') || err.message.includes('403')) return false;
    return true;
  },
};

export class BybitClient {
  private client: RestClientV5;

  constructor(apiKey: string, apiSecret: string, testnet: boolean) {
    this.client = new RestClientV5({ key: apiKey, secret: apiSecret, testnet });
    log.info({ testnet }, 'bybit client initialized');
  }

  async getOnlineAds(side: Side, currencyId = 'USDT', fiatId = 'BOB'): Promise<BybitAd[]> {
    return withRetry(async () => {
      const res = await this.client.getP2POnlineAds({
        tokenId: currencyId,
        currencyId: fiatId,
        side: side === 'buy' ? '1' : '0',
      });
      if (res.retCode !== 0) throw new Error(`Bybit error ${res.retCode}: ${res.retMsg}`);
      const items = (res.result as any)?.items || [];
      return items.map((item: any) => ({
        id: item.id,
        side,
        price: parseFloat(item.price),
        amount: parseFloat(item.lastQuantity || item.quantity),
        status: item.status,
      }));
    }, RETRY_OPTIONS);
  }

  async getPersonalAds(): Promise<BybitAd[]> {
    return withRetry(async () => {
      const res = await this.client.getP2PPersonalAds({});
      if (res.retCode !== 0) throw new Error(`Bybit error ${res.retCode}: ${res.retMsg}`);
      const items = (res.result as any)?.items || [];
      return items.map((item: any) => ({
        id: item.id,
        side: item.side === '1' ? 'buy' as const : 'sell' as const,
        price: parseFloat(item.price),
        amount: parseFloat(item.lastQuantity || item.quantity),
        status: item.status,
      }));
    }, RETRY_OPTIONS);
  }

  async createAd(params: BybitAdParams): Promise<string> {
    return withRetry(async () => {
      const res = await this.client.createP2PAd({
        tokenId: params.currencyId,
        currencyId: params.fiatCurrencyId,
        side: params.side === 'buy' ? '1' : '0',
        price: String(params.price),
        quantity: String(params.amount),
        paymentIds: params.paymentMethodIds,
        remark: params.remark || '',
      } as any);
      if (res.retCode !== 0) throw new Error(`Bybit error ${res.retCode}: ${res.retMsg}`);
      return (res.result as any)?.id || '';
    }, RETRY_OPTIONS);
  }

  async updateAd(adId: string, price: number, amount: number): Promise<void> {
    return withRetry(async () => {
      const res = await this.client.updateP2PAd({
        id: adId,
        price: String(price),
        quantity: String(amount),
      } as any);
      if (res.retCode !== 0) throw new Error(`Bybit error ${res.retCode}: ${res.retMsg}`);
    }, RETRY_OPTIONS);
  }

  async cancelAd(adId: string): Promise<void> {
    return withRetry(async () => {
      const res = await this.client.cancelP2PAd({ id: adId } as any);
      if (res.retCode !== 0) throw new Error(`Bybit error ${res.retCode}: ${res.retMsg}`);
    }, RETRY_OPTIONS);
  }

  async getPendingOrders(): Promise<BybitOrder[]> {
    return withRetry(async () => {
      const res = await this.client.getP2PPendingOrders({});
      if (res.retCode !== 0) throw new Error(`Bybit error ${res.retCode}: ${res.retMsg}`);
      const items = (res.result as any)?.items || [];
      return items.map((item: any) => ({
        id: item.id,
        side: item.side === '1' ? 'buy' as const : 'sell' as const,
        amount: parseFloat(item.amount),
        price: parseFloat(item.price),
        totalBob: parseFloat(item.totalPrice || '0'),
        status: item.orderStatus,
        counterpartyId: item.targetUserId || '',
        counterpartyName: item.targetNickName || '',
        createdAt: parseInt(item.createDate || '0'),
      }));
    }, RETRY_OPTIONS);
  }

  async getOrderDetail(orderId: string): Promise<BybitOrder> {
    return withRetry(async () => {
      const res = await this.client.getP2POrderDetail({ id: orderId } as any);
      if (res.retCode !== 0) throw new Error(`Bybit error ${res.retCode}: ${res.retMsg}`);
      const item = res.result as any;
      return {
        id: item.id,
        side: item.side === '1' ? 'buy' as const : 'sell' as const,
        amount: parseFloat(item.amount),
        price: parseFloat(item.price),
        totalBob: parseFloat(item.totalPrice || '0'),
        status: item.orderStatus,
        counterpartyId: item.targetUserId || '',
        counterpartyName: item.targetNickName || '',
        createdAt: parseInt(item.createDate || '0'),
      };
    }, RETRY_OPTIONS);
  }

  async markOrderAsPaid(orderId: string): Promise<void> {
    return withRetry(async () => {
      const res = await this.client.markP2POrderAsPaid({ id: orderId } as any);
      if (res.retCode !== 0) throw new Error(`Bybit error ${res.retCode}: ${res.retMsg}`);
    }, RETRY_OPTIONS);
  }

  async releaseOrder(orderId: string): Promise<void> {
    // NO retry on release — too dangerous. If it fails, human must decide.
    const res = await this.client.releaseP2POrder({ id: orderId } as any);
    if (res.retCode !== 0) throw new Error(`Bybit error ${res.retCode}: ${res.retMsg}`);
  }

  async getBalance(coin = 'USDT'): Promise<BybitBalance> {
    return withRetry(async () => {
      const res = await this.client.getP2PAccountCoinsBalance({ coin });
      if (res.retCode !== 0) throw new Error(`Bybit error ${res.retCode}: ${res.retMsg}`);
      const balance = (res.result as any)?.balance || [];
      const entry = balance.find((b: any) => b.coin === coin) || { coin, transferBalance: '0', walletBalance: '0' };
      return {
        coin,
        available: parseFloat(entry.transferBalance || '0'),
        frozen: parseFloat(entry.walletBalance || '0') - parseFloat(entry.transferBalance || '0'),
      };
    }, RETRY_OPTIONS);
  }
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/bybit/types.ts src/bybit/client.ts
git commit -m "feat: Bybit P2P client wrapper over bybit-api SDK"
```

---

## Task 7: CriptoYa Client + PriceMonitor

**Files:**
- Create: `src/modules/price-monitor/types.ts`
- Create: `src/modules/price-monitor/criptoya.ts`
- Create: `src/modules/price-monitor/index.ts`
- Test: `tests/modules/price-monitor/criptoya.test.ts`
- Test: `tests/modules/price-monitor/index.test.ts`

- [ ] **Step 1: Create types**

Create `src/modules/price-monitor/types.ts`:

```typescript
export interface CriptoYaPrices {
  [exchange: string]: {
    ask: number;
    totalAsk: number;
    bid: number;
    totalBid: number;
    time: number;
  };
}

export interface PriceSnapshot {
  price: number;    // average mid-price across platforms
  timestamp: number;
}
```

- [ ] **Step 2: Write failing test for CriptoYa client**

Create `tests/modules/price-monitor/criptoya.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CriptoYaClient } from '../../../src/modules/price-monitor/criptoya.js';

describe('CriptoYaClient', () => {
  let client: CriptoYaClient;

  beforeEach(() => {
    client = new CriptoYaClient();
  });

  it('parses USDT/BOB prices from response', async () => {
    const mockResponse = {
      binancep2p: { ask: 9.37, totalAsk: 9.37, bid: 9.34, totalBid: 9.34, time: 1000 },
      bybitp2p: { ask: 9.35, totalAsk: 9.35, bid: 9.33, totalBid: 9.33, time: 1000 },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const prices = await client.getUsdtBobPrices();
    expect(prices).toHaveLength(2);
    expect(prices[0].platform).toBe('binancep2p');
    expect(prices[0].ask).toBe(9.37);
    expect(prices[1].platform).toBe('bybitp2p');
  });

  it('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    await expect(client.getUsdtBobPrices()).rejects.toThrow('CriptoYa API error: 500');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/modules/price-monitor/criptoya.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement CriptoYa client**

Create `src/modules/price-monitor/criptoya.ts`:

```typescript
import type { PlatformPrices } from '../../event-bus.js';
import type { CriptoYaPrices } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('criptoya');

const BASE_URL = 'https://criptoya.com/api';

export class CriptoYaClient {
  async getUsdtBobPrices(): Promise<PlatformPrices[]> {
    const res = await fetch(`${BASE_URL}/usdt/bob`);
    if (!res.ok) {
      throw new Error(`CriptoYa API error: ${res.status}`);
    }
    const data: CriptoYaPrices = await res.json();
    return Object.entries(data).map(([platform, prices]) => ({
      platform,
      ask: prices.ask,
      totalAsk: prices.totalAsk,
      bid: prices.bid,
      totalBid: prices.totalBid,
      time: prices.time,
    }));
  }

  async getFees(): Promise<Record<string, any>> {
    const res = await fetch(`${BASE_URL}/fees`);
    if (!res.ok) {
      throw new Error(`CriptoYa fees API error: ${res.status}`);
    }
    return res.json();
  }
}
```

- [ ] **Step 5: Run CriptoYa test**

Run: `npx vitest run tests/modules/price-monitor/criptoya.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 6: Write failing test for PriceMonitor**

Create `tests/modules/price-monitor/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceMonitor } from '../../../src/modules/price-monitor/index.js';
import { EventBus } from '../../../src/event-bus.js';
import { createTestDB } from '../../../src/db/index.js';
import type { DB } from '../../../src/db/index.js';

describe('PriceMonitor', () => {
  let db: DB;
  let close: () => void;
  let bus: EventBus;

  beforeEach(() => {
    const testDb = createTestDB();
    db = testDb.db;
    close = testDb.close;
    bus = new EventBus(db);
  });

  afterEach(() => {
    bus.removeAllListeners();
    close();
  });

  it('emits price:updated with fetched prices', async () => {
    const mockPrices = [
      { platform: 'bybitp2p', ask: 9.35, totalAsk: 9.35, bid: 9.33, totalBid: 9.33, time: 1000 },
    ];
    const mockClient = { getUsdtBobPrices: vi.fn().mockResolvedValue(mockPrices), getFees: vi.fn() };
    const monitor = new PriceMonitor(bus, db, mockClient as any);

    const received = vi.fn();
    bus.on('price:updated', received);

    await monitor.fetchOnce();

    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({ prices: mockPrices })
    );
  });

  it('emits price:volatility-alert when price change exceeds threshold', async () => {
    const mockClient = {
      getUsdtBobPrices: vi.fn(),
      getFees: vi.fn(),
    };
    const monitor = new PriceMonitor(bus, db, mockClient as any, {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
    });

    const received = vi.fn();
    bus.on('price:volatility-alert', received);

    // First fetch: price 9.35
    mockClient.getUsdtBobPrices.mockResolvedValueOnce([
      { platform: 'bybitp2p', ask: 9.35, totalAsk: 9.35, bid: 9.33, totalBid: 9.33, time: 1000 },
    ]);
    await monitor.fetchOnce();

    // Second fetch: price 9.60 (>2% change)
    mockClient.getUsdtBobPrices.mockResolvedValueOnce([
      { platform: 'bybitp2p', ask: 9.60, totalAsk: 9.60, bid: 9.58, totalBid: 9.58, time: 2000 },
    ]);
    await monitor.fetchOnce();

    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({ changePercent: expect.any(Number) })
    );
  });

  it('emits price:stale when data is old', async () => {
    const mockClient = {
      getUsdtBobPrices: vi.fn().mockRejectedValue(new Error('timeout')),
      getFees: vi.fn(),
    };
    const monitor = new PriceMonitor(bus, db, mockClient as any);

    const received = vi.fn();
    bus.on('price:stale', received);

    // Simulate staleness by setting last update to >5 min ago
    monitor['lastUpdateTime'] = Date.now() - 6 * 60 * 1000;
    await monitor.fetchOnce();

    expect(received).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/modules/price-monitor/index.test.ts`
Expected: FAIL.

- [ ] **Step 8: Implement PriceMonitor**

Create `src/modules/price-monitor/index.ts`:

```typescript
import type { EventBus, PlatformPrices } from '../../event-bus.js';
import type { DB } from '../../db/index.js';
import type { CriptoYaClient } from './criptoya.js';
import type { PriceSnapshot } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('price-monitor');

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

interface PriceMonitorConfig {
  volatilityThresholdPercent: number;
  volatilityWindowMinutes: number;
}

export class PriceMonitor {
  private bus: EventBus;
  private db: DB;
  private client: CriptoYaClient;
  private config: PriceMonitorConfig;
  private priceHistory: PriceSnapshot[] = [];
  private lastUpdateTime = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private latestPrices: PlatformPrices[] = [];

  constructor(bus: EventBus, db: DB, client: CriptoYaClient, config?: Partial<PriceMonitorConfig>) {
    this.bus = bus;
    this.db = db;
    this.client = client;
    this.config = {
      volatilityThresholdPercent: config?.volatilityThresholdPercent ?? 2,
      volatilityWindowMinutes: config?.volatilityWindowMinutes ?? 5,
    };
  }

  async fetchOnce(): Promise<void> {
    try {
      const prices = await this.client.getUsdtBobPrices();
      this.latestPrices = prices;
      this.lastUpdateTime = Date.now();

      this.bus.emit('price:updated', { prices, timestamp: this.lastUpdateTime }, 'price-monitor');

      // Calculate average mid-price for volatility tracking
      const validPrices = prices.filter((p) => p.ask > 0 && p.bid > 0);
      if (validPrices.length > 0) {
        const avgMid = validPrices.reduce((sum, p) => sum + (p.ask + p.bid) / 2, 0) / validPrices.length;
        this.priceHistory.push({ price: avgMid, timestamp: this.lastUpdateTime });
        this.checkVolatility(avgMid);
      }

      // Trim history to window
      const windowStart = Date.now() - this.config.volatilityWindowMinutes * 60 * 1000;
      this.priceHistory = this.priceHistory.filter((s) => s.timestamp >= windowStart);

      log.debug({ count: prices.length }, 'prices fetched');
    } catch (err) {
      log.error({ err }, 'failed to fetch prices');
      this.checkStale();
    }
  }

  private checkVolatility(currentPrice: number): void {
    if (this.priceHistory.length < 2) return;

    const windowStart = Date.now() - this.config.volatilityWindowMinutes * 60 * 1000;
    const oldestInWindow = this.priceHistory.find((s) => s.timestamp >= windowStart);
    if (!oldestInWindow) return;

    const changePercent = Math.abs((currentPrice - oldestInWindow.price) / oldestInWindow.price) * 100;

    if (changePercent >= this.config.volatilityThresholdPercent) {
      log.warn({ currentPrice, previousPrice: oldestInWindow.price, changePercent }, 'volatility alert');
      this.bus.emit('price:volatility-alert', {
        currentPrice,
        previousPrice: oldestInWindow.price,
        changePercent,
        windowMinutes: this.config.volatilityWindowMinutes,
      }, 'price-monitor');
    }
  }

  private checkStale(): void {
    if (this.lastUpdateTime === 0) return;
    const staleDuration = Date.now() - this.lastUpdateTime;
    if (staleDuration > STALE_THRESHOLD_MS) {
      log.warn({ staleDurationSeconds: staleDuration / 1000 }, 'price data stale');
      this.bus.emit('price:stale', {
        lastUpdate: this.lastUpdateTime,
        staleDurationSeconds: Math.floor(staleDuration / 1000),
      }, 'price-monitor');
    }
  }

  start(intervalMs: number): void {
    log.info({ intervalMs }, 'starting price monitor');
    this.intervalId = setInterval(() => this.fetchOnce(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    log.info('price monitor stopped');
  }

  getLatestPrices(): PlatformPrices[] {
    return this.latestPrices;
  }

  getBybitPrices(): { ask: number; bid: number } | null {
    const bybit = this.latestPrices.find((p) => p.platform === 'bybitp2p');
    if (!bybit || bybit.ask === 0 || bybit.bid === 0) return null;
    return { ask: bybit.ask, bid: bybit.bid };
  }
}
```

- [ ] **Step 9: Run tests**

Run: `npx vitest run tests/modules/price-monitor/`
Expected: 5 tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/modules/price-monitor/ tests/modules/price-monitor/
git commit -m "feat: PriceMonitor module with CriptoYa client, volatility detection, and stale alerts"
```

---

## Task 8: BankManager Module

**Files:**
- Create: `src/modules/bank-manager/types.ts`
- Create: `src/modules/bank-manager/selector.ts`
- Create: `src/modules/bank-manager/index.ts`
- Test: `tests/modules/bank-manager/selector.test.ts`
- Test: `tests/modules/bank-manager/index.test.ts`

- [ ] **Step 1: Create types**

Create `src/modules/bank-manager/types.ts`:

```typescript
export interface BankAccountRecord {
  id: number;
  name: string;
  bank: string;
  accountHint: string;
  balanceBob: number;
  dailyVolume: number;
  dailyLimit: number;
  monthlyVolume: number;
  status: string;
  priority: number;
}

export interface SelectionCriteria {
  minBalance: number;  // minimum BOB balance needed for the trade
  side: 'buy' | 'sell';
}
```

- [ ] **Step 2: Write failing test for selector**

Create `tests/modules/bank-manager/selector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { selectBestAccount } from '../../../src/modules/bank-manager/selector.js';
import type { BankAccountRecord } from '../../../src/modules/bank-manager/types.js';

const makeAccount = (overrides: Partial<BankAccountRecord>): BankAccountRecord => ({
  id: 1,
  name: 'Test Bank',
  bank: 'test',
  accountHint: '0000',
  balanceBob: 10000,
  dailyVolume: 0,
  dailyLimit: 50000,
  monthlyVolume: 0,
  status: 'active',
  priority: 1,
  ...overrides,
});

describe('selectBestAccount', () => {
  it('returns null when no accounts available', () => {
    expect(selectBestAccount([], { minBalance: 5000, side: 'buy' })).toBeNull();
  });

  it('filters out inactive accounts', () => {
    const accounts = [makeAccount({ status: 'frozen' })];
    expect(selectBestAccount(accounts, { minBalance: 5000, side: 'buy' })).toBeNull();
  });

  it('filters out accounts with insufficient balance for buy side', () => {
    const accounts = [makeAccount({ balanceBob: 3000 })];
    expect(selectBestAccount(accounts, { minBalance: 5000, side: 'buy' })).toBeNull();
  });

  it('does not filter by balance for sell side', () => {
    const accounts = [makeAccount({ balanceBob: 0 })];
    const result = selectBestAccount(accounts, { minBalance: 5000, side: 'sell' });
    expect(result).not.toBeNull();
  });

  it('filters out accounts at daily limit', () => {
    const accounts = [makeAccount({ dailyVolume: 50000, dailyLimit: 50000 })];
    expect(selectBestAccount(accounts, { minBalance: 5000, side: 'buy' })).toBeNull();
  });

  it('prefers higher priority accounts', () => {
    const accounts = [
      makeAccount({ id: 1, priority: 5, balanceBob: 20000 }),
      makeAccount({ id: 2, priority: 10, balanceBob: 20000 }),
    ];
    const result = selectBestAccount(accounts, { minBalance: 5000, side: 'buy' });
    expect(result?.id).toBe(2);
  });

  it('considers remaining daily capacity in selection', () => {
    const accounts = [
      makeAccount({ id: 1, priority: 10, dailyVolume: 49000, dailyLimit: 50000 }),
      makeAccount({ id: 2, priority: 5, dailyVolume: 0, dailyLimit: 50000 }),
    ];
    // Account 2 has way more remaining capacity despite lower priority
    const result = selectBestAccount(accounts, { minBalance: 5000, side: 'buy' });
    expect(result?.id).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/modules/bank-manager/selector.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement selector**

Create `src/modules/bank-manager/selector.ts`:

```typescript
import type { BankAccountRecord, SelectionCriteria } from './types.js';

export function selectBestAccount(
  accounts: BankAccountRecord[],
  criteria: SelectionCriteria,
): BankAccountRecord | null {
  const eligible = accounts.filter((acct) => {
    if (acct.status !== 'active') return false;
    if (acct.dailyLimit > 0 && acct.dailyVolume >= acct.dailyLimit) return false;
    // For buy side, we need sufficient BOB to pay counterparty
    if (criteria.side === 'buy' && acct.balanceBob < criteria.minBalance) return false;
    return true;
  });

  if (eligible.length === 0) return null;

  // Score: priority * remaining_daily_capacity_ratio
  // This balances between preferred accounts and spreading volume
  const scored = eligible.map((acct) => {
    const remainingCapacity = acct.dailyLimit > 0
      ? (acct.dailyLimit - acct.dailyVolume) / acct.dailyLimit
      : 1;
    const score = acct.priority * remainingCapacity;
    return { acct, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].acct;
}
```

- [ ] **Step 5: Run selector test**

Run: `npx vitest run tests/modules/bank-manager/selector.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 6: Write failing test for BankManager**

Create `tests/modules/bank-manager/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BankManager } from '../../../src/modules/bank-manager/index.js';
import { EventBus } from '../../../src/event-bus.js';
import { createTestDB, schema } from '../../../src/db/index.js';
import type { DB } from '../../../src/db/index.js';

describe('BankManager', () => {
  let db: DB;
  let close: () => void;
  let bus: EventBus;
  let manager: BankManager;

  beforeEach(() => {
    const testDb = createTestDB();
    db = testDb.db;
    close = testDb.close;
    bus = new EventBus(db);
    manager = new BankManager(bus, db);

    // Seed a bank account
    db.insert(schema.bankAccounts).values({
      name: 'Banco Union',
      bank: 'banco-union',
      accountHint: '4521',
      balanceBob: 15000,
      dailyLimit: 50000,
      priority: 10,
      updatedAt: Date.now(),
    }).run();
  });

  afterEach(() => {
    bus.removeAllListeners();
    close();
  });

  it('loads accounts from DB', async () => {
    await manager.loadAccounts();
    const accounts = manager.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Banco Union');
  });

  it('selects best account for a trade', async () => {
    await manager.loadAccounts();
    const account = manager.selectAccount({ minBalance: 5000, side: 'buy' });
    expect(account).not.toBeNull();
    expect(account?.name).toBe('Banco Union');
  });

  it('updates balance after trade completion', async () => {
    await manager.loadAccounts();
    manager.updateBalanceAfterTrade(1, -4675); // buy: spent BOB
    const accounts = manager.getAccounts();
    expect(accounts[0].balanceBob).toBe(15000 - 4675);
  });

  it('emits bank:low-balance when balance drops below 1000', async () => {
    await manager.loadAccounts();
    const handler = vi.fn();
    bus.on('bank:low-balance', handler);

    manager.updateBalanceAfterTrade(1, -14500); // leaves 500 BOB

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 1, balance: 500 })
    );
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/modules/bank-manager/index.test.ts`
Expected: FAIL.

- [ ] **Step 8: Implement BankManager**

Create `src/modules/bank-manager/index.ts`:

```typescript
import type { EventBus } from '../../event-bus.js';
import type { DB } from '../../db/index.js';
import { bankAccounts } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { selectBestAccount } from './selector.js';
import type { BankAccountRecord, SelectionCriteria } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('bank-manager');

const LOW_BALANCE_THRESHOLD = 1000;

export class BankManager {
  private bus: EventBus;
  private db: DB;
  private accounts: BankAccountRecord[] = [];

  constructor(bus: EventBus, db: DB) {
    this.bus = bus;
    this.db = db;
  }

  async loadAccounts(): Promise<void> {
    const rows = this.db.select().from(bankAccounts).all();
    this.accounts = rows.map((r) => ({
      id: r.id,
      name: r.name,
      bank: r.bank,
      accountHint: r.accountHint,
      balanceBob: r.balanceBob,
      dailyVolume: r.dailyVolume,
      dailyLimit: r.dailyLimit,
      monthlyVolume: r.monthlyVolume,
      status: r.status,
      priority: r.priority,
    }));
    log.info({ count: this.accounts.length }, 'accounts loaded');
  }

  getAccounts(): BankAccountRecord[] {
    return this.accounts;
  }

  getAccountById(id: number): BankAccountRecord | undefined {
    return this.accounts.find((a) => a.id === id);
  }

  selectAccount(criteria: SelectionCriteria): BankAccountRecord | null {
    return selectBestAccount(this.accounts, criteria);
  }

  updateBalanceAfterTrade(accountId: number, bobDelta: number): void {
    const account = this.accounts.find((a) => a.id === accountId);
    if (!account) return;

    account.balanceBob += bobDelta;
    account.dailyVolume += Math.abs(bobDelta);
    account.monthlyVolume += Math.abs(bobDelta);

    // Persist to DB
    this.db.update(bankAccounts)
      .set({
        balanceBob: account.balanceBob,
        dailyVolume: account.dailyVolume,
        monthlyVolume: account.monthlyVolume,
        updatedAt: Date.now(),
      })
      .where(eq(bankAccounts.id, accountId))
      .run();

    this.bus.emit('bank:balance-updated', {
      accountId,
      newBalance: account.balanceBob,
    }, 'bank-manager');

    if (account.balanceBob < LOW_BALANCE_THRESHOLD) {
      this.bus.emit('bank:low-balance', {
        accountId,
        balance: account.balanceBob,
        threshold: LOW_BALANCE_THRESHOLD,
      }, 'bank-manager');
    }

    if (account.dailyLimit > 0 && account.dailyVolume >= account.dailyLimit) {
      this.bus.emit('bank:daily-limit', {
        accountId,
        dailyVolume: account.dailyVolume,
        limit: account.dailyLimit,
      }, 'bank-manager');
    }
  }

  setBalance(accountId: number, balance: number): void {
    const account = this.accounts.find((a) => a.id === accountId);
    if (!account) return;
    account.balanceBob = balance;
    this.db.update(bankAccounts)
      .set({ balanceBob: balance, updatedAt: Date.now() })
      .where(eq(bankAccounts.id, accountId))
      .run();
    log.info({ accountId, balance }, 'manual balance update');
  }

  resetDailyVolumes(): void {
    for (const account of this.accounts) {
      account.dailyVolume = 0;
    }
    this.db.update(bankAccounts).set({ dailyVolume: 0, updatedAt: Date.now() }).run();
    log.info('daily volumes reset');
  }

  getTotalBobBalance(): number {
    return this.accounts
      .filter((a) => a.status === 'active')
      .reduce((sum, a) => sum + a.balanceBob, 0);
  }
}
```

- [ ] **Step 9: Run all bank-manager tests**

Run: `npx vitest run tests/modules/bank-manager/`
Expected: 11 tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/modules/bank-manager/ tests/modules/bank-manager/
git commit -m "feat: BankManager module with balance-aware account selection"
```

---

## Task 9: AdManager Module

**Files:**
- Create: `src/modules/ad-manager/types.ts`
- Create: `src/modules/ad-manager/pricing.ts`
- Create: `src/modules/ad-manager/index.ts`
- Test: `tests/modules/ad-manager/pricing.test.ts`
- Test: `tests/modules/ad-manager/index.test.ts`

- [ ] **Step 1: Create types**

Create `src/modules/ad-manager/types.ts`:

```typescript
export interface PricingConfig {
  minSpread: number;
  maxSpread: number;
  tradeAmountUsdt: number;
}

export interface PricingResult {
  buyPrice: number;
  sellPrice: number;
  spread: number;
  paused: { buy: boolean; sell: boolean; reason?: string };
}
```

- [ ] **Step 2: Write failing test for pricing**

Create `tests/modules/ad-manager/pricing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calculatePricing } from '../../../src/modules/ad-manager/pricing.js';
import type { PlatformPrices } from '../../../src/event-bus.js';

describe('calculatePricing', () => {
  const basePrices: PlatformPrices[] = [
    { platform: 'bybitp2p', ask: 9.35, totalAsk: 9.35, bid: 9.33, totalBid: 9.33, time: 1000 },
    { platform: 'binancep2p', ask: 9.37, totalAsk: 9.37, bid: 9.34, totalBid: 9.34, time: 1000 },
  ];

  it('calculates buy and sell prices with spread around market mid', () => {
    const result = calculatePricing(basePrices, { minSpread: 0.01, maxSpread: 0.05, tradeAmountUsdt: 500 });
    expect(result.buyPrice).toBeLessThan(result.sellPrice);
    expect(result.spread).toBeGreaterThanOrEqual(0.01);
    expect(result.spread).toBeLessThanOrEqual(0.05);
  });

  it('pauses both sides when no valid prices', () => {
    const result = calculatePricing([], { minSpread: 0.01, maxSpread: 0.05, tradeAmountUsdt: 500 });
    expect(result.paused.buy).toBe(true);
    expect(result.paused.sell).toBe(true);
  });

  it('enforces minimum spread', () => {
    // Prices with very tight spread
    const tightPrices: PlatformPrices[] = [
      { platform: 'bybitp2p', ask: 9.335, totalAsk: 9.335, bid: 9.333, totalBid: 9.333, time: 1000 },
    ];
    const result = calculatePricing(tightPrices, { minSpread: 0.02, maxSpread: 0.05, tradeAmountUsdt: 500 });
    expect(result.spread).toBeGreaterThanOrEqual(0.02);
  });

  it('caps at maximum spread', () => {
    // Prices with wide spread
    const widePrices: PlatformPrices[] = [
      { platform: 'mexcp2p', ask: 9.70, totalAsk: 9.70, bid: 9.10, totalBid: 9.10, time: 1000 },
    ];
    const result = calculatePricing(widePrices, { minSpread: 0.01, maxSpread: 0.05, tradeAmountUsdt: 500 });
    expect(result.spread).toBeLessThanOrEqual(0.05);
  });

  it('detects spread inversion', () => {
    // This shouldn't normally happen but tests the guard
    const result = calculatePricing(basePrices, { minSpread: 5.0, maxSpread: 10.0, tradeAmountUsdt: 500 });
    expect(result.paused.buy).toBe(true);
    expect(result.paused.sell).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/modules/ad-manager/pricing.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement pricing**

Create `src/modules/ad-manager/pricing.ts`:

```typescript
import type { PlatformPrices } from '../../event-bus.js';
import type { PricingResult, PricingConfig } from './types.js';

export function calculatePricing(
  prices: PlatformPrices[],
  config: PricingConfig,
): PricingResult {
  const validPrices = prices.filter((p) => p.ask > 0 && p.bid > 0);

  if (validPrices.length === 0) {
    return {
      buyPrice: 0,
      sellPrice: 0,
      spread: 0,
      paused: { buy: true, sell: true, reason: 'no valid market prices' },
    };
  }

  // Use Bybit prices if available, otherwise average across platforms
  const bybit = validPrices.find((p) => p.platform === 'bybitp2p');
  const reference = bybit || {
    ask: validPrices.reduce((s, p) => s + p.ask, 0) / validPrices.length,
    bid: validPrices.reduce((s, p) => s + p.bid, 0) / validPrices.length,
  };

  const marketMid = (reference.ask + reference.bid) / 2;
  const marketSpread = reference.ask - reference.bid;

  // Target spread: use market spread clamped to [minSpread, maxSpread]
  const targetSpread = Math.max(config.minSpread, Math.min(config.maxSpread, marketSpread));

  const buyPrice = Math.round((marketMid - targetSpread / 2) * 10000) / 10000;
  const sellPrice = Math.round((marketMid + targetSpread / 2) * 10000) / 10000;

  // Sanity check: buy must be less than sell
  if (buyPrice >= sellPrice) {
    return {
      buyPrice: 0,
      sellPrice: 0,
      spread: 0,
      paused: { buy: true, sell: true, reason: 'spread inversion — buy >= sell' },
    };
  }

  return {
    buyPrice,
    sellPrice,
    spread: sellPrice - buyPrice,
    paused: { buy: false, sell: false },
  };
}
```

- [ ] **Step 5: Run pricing test**

Run: `npx vitest run tests/modules/ad-manager/pricing.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 6: Implement AdManager**

Create `src/modules/ad-manager/index.ts`:

```typescript
import type { EventBus, PlatformPrices, Side } from '../../event-bus.js';
import type { DB } from '../../db/index.js';
import type { BybitClient } from '../../bybit/client.js';
import { ads } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { calculatePricing } from './pricing.js';
import type { PricingConfig } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('ad-manager');

interface ActiveAd {
  bybitAdId: string;
  side: Side;
  price: number;
  bankAccountId: number;
}

export class AdManager {
  private bus: EventBus;
  private db: DB;
  private bybit: BybitClient;
  private config: PricingConfig;
  private activeAds: Map<Side, ActiveAd> = new Map();
  private latestPrices: PlatformPrices[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private paused: { buy: boolean; sell: boolean } = { buy: false, sell: false };

  constructor(
    bus: EventBus,
    db: DB,
    bybit: BybitClient,
    config: PricingConfig,
    private getBankAccount: (side: Side, amount: number) => { id: number; name: string } | null,
  ) {
    this.bus = bus;
    this.db = db;
    this.bybit = bybit;
    this.config = config;

    this.bus.on('price:updated', (payload) => {
      this.latestPrices = payload.prices;
    });
  }

  async syncExistingAds(): Promise<void> {
    try {
      const personalAds = await this.bybit.getPersonalAds();
      for (const ad of personalAds) {
        if (ad.status === '1' || ad.status === 'active') { // active on Bybit
          this.activeAds.set(ad.side, {
            bybitAdId: ad.id,
            side: ad.side,
            price: ad.price,
            bankAccountId: 0, // unknown from Bybit response
          });
          log.info({ adId: ad.id, side: ad.side, price: ad.price }, 'synced existing ad');
        }
      }
    } catch (err) {
      log.error({ err }, 'failed to sync existing ads');
    }
  }

  async tick(): Promise<void> {
    if (this.latestPrices.length === 0) {
      log.debug('no prices yet, skipping tick');
      return;
    }

    const pricing = calculatePricing(this.latestPrices, this.config);

    if (pricing.paused.buy && pricing.paused.sell) {
      if (pricing.paused.reason?.includes('inversion')) {
        this.bus.emit('ad:spread-inversion', {
          buyPrice: pricing.buyPrice,
          sellPrice: pricing.sellPrice,
        }, 'ad-manager');
      }
      await this.pauseAllAds(pricing.paused.reason || 'pricing unavailable');
      return;
    }

    await this.manageSide('buy', pricing.buyPrice, pricing.paused.buy);
    await this.manageSide('sell', pricing.sellPrice, pricing.paused.sell);
  }

  private async manageSide(side: Side, price: number, shouldPause: boolean): Promise<void> {
    const existing = this.activeAds.get(side);

    if (shouldPause || this.paused[side]) {
      if (existing) {
        await this.removeAd(side);
        this.bus.emit('ad:paused', { side, reason: 'spread below minimum' }, 'ad-manager');
      }
      return;
    }

    if (existing) {
      // Reprice if price changed
      if (Math.abs(existing.price - price) > 0.0001) {
        try {
          await this.bybit.updateAd(existing.bybitAdId, price, this.config.tradeAmountUsdt);
          const oldPrice = existing.price;
          existing.price = price;
          this.bus.emit('ad:repriced', { adId: existing.bybitAdId, side, oldPrice, newPrice: price }, 'ad-manager');
          log.info({ side, oldPrice, newPrice: price }, 'ad repriced');
        } catch (err) {
          log.error({ err, side }, 'failed to reprice ad, removing and recreating');
          await this.removeAd(side);
        }
      }
    } else {
      // Create new ad
      const bankAccount = this.getBankAccount(side, this.config.tradeAmountUsdt * price);
      if (!bankAccount) {
        log.warn({ side }, 'no bank account available, pausing side');
        this.bus.emit('ad:paused', { side, reason: 'no bank account available' }, 'ad-manager');
        return;
      }

      try {
        const adId = await this.bybit.createAd({
          side,
          price,
          amount: this.config.tradeAmountUsdt,
          currencyId: 'USDT',
          fiatCurrencyId: 'BOB',
          paymentMethodIds: [], // Bybit uses account-level payment methods
        });

        this.activeAds.set(side, { bybitAdId: adId, side, price, bankAccountId: bankAccount.id });

        this.db.insert(ads).values({
          bybitAdId: adId,
          side,
          price,
          amountUsdt: this.config.tradeAmountUsdt,
          bankAccountId: bankAccount.id,
          status: 'active',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }).run();

        this.bus.emit('ad:created', { adId, side, price, bankAccount: bankAccount.name }, 'ad-manager');
        log.info({ adId, side, price, bank: bankAccount.name }, 'ad created');
      } catch (err) {
        log.error({ err, side }, 'failed to create ad');
      }
    }
  }

  async removeAd(side: Side): Promise<void> {
    const existing = this.activeAds.get(side);
    if (!existing) return;

    try {
      await this.bybit.cancelAd(existing.bybitAdId);
    } catch (err) {
      log.error({ err, side }, 'failed to cancel ad on Bybit');
    }

    this.db.update(ads)
      .set({ status: 'removed', updatedAt: Date.now() })
      .where(eq(ads.bybitAdId, existing.bybitAdId))
      .run();

    this.activeAds.delete(side);
  }

  async removeAllAds(): Promise<void> {
    await this.removeAd('buy');
    await this.removeAd('sell');
  }

  private async pauseAllAds(reason: string): Promise<void> {
    for (const side of ['buy', 'sell'] as Side[]) {
      const existing = this.activeAds.get(side);
      if (existing) {
        await this.removeAd(side);
        this.bus.emit('ad:paused', { side, reason }, 'ad-manager');
      }
    }
  }

  setPaused(side: Side | 'both', paused: boolean): void {
    if (side === 'both') {
      this.paused.buy = paused;
      this.paused.sell = paused;
    } else {
      this.paused[side] = paused;
    }
  }

  updateConfig(config: Partial<PricingConfig>): void {
    Object.assign(this.config, config);
    log.info({ config: this.config }, 'pricing config updated');
  }

  start(intervalMs: number): void {
    log.info({ intervalMs }, 'starting ad manager');
    this.intervalId = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    log.info('ad manager stopped');
  }

  getActiveAds(): Map<Side, ActiveAd> {
    return this.activeAds;
  }
}
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/ad-manager/ tests/modules/ad-manager/
git commit -m "feat: AdManager module with CriptoYa-informed pricing and spread bounds"
```

---

## Task 10: OrderHandler Module

**Files:**
- Create: `src/modules/order-handler/types.ts`
- Create: `src/modules/order-handler/lifecycle.ts`
- Create: `src/modules/order-handler/index.ts`
- Test: `tests/modules/order-handler/lifecycle.test.ts`

- [ ] **Step 1: Create types**

Create `src/modules/order-handler/types.ts`:

```typescript
export type OrderStatus =
  | 'new'
  | 'awaiting_payment'
  | 'payment_marked'
  | 'released'
  | 'cancelled'
  | 'disputed';

export interface TrackedOrder {
  id: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  totalBob: number;
  status: OrderStatus;
  counterpartyId: string;
  counterpartyName: string;
  bankAccountId: number;
  createdAt: number;
  autoCancelAt: number | null; // timestamp for auto-cancel
}
```

- [ ] **Step 2: Write failing test for lifecycle**

Create `tests/modules/order-handler/lifecycle.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { transitionOrder, canTransition } from '../../../src/modules/order-handler/lifecycle.js';
import type { OrderStatus } from '../../../src/modules/order-handler/types.js';

describe('Order lifecycle', () => {
  it('allows new → awaiting_payment', () => {
    expect(canTransition('new', 'awaiting_payment')).toBe(true);
  });

  it('allows awaiting_payment → payment_marked', () => {
    expect(canTransition('awaiting_payment', 'payment_marked')).toBe(true);
  });

  it('allows payment_marked → released', () => {
    expect(canTransition('payment_marked', 'released')).toBe(true);
  });

  it('allows payment_marked → disputed', () => {
    expect(canTransition('payment_marked', 'disputed')).toBe(true);
  });

  it('allows new → cancelled', () => {
    expect(canTransition('new', 'cancelled')).toBe(true);
  });

  it('allows awaiting_payment → cancelled', () => {
    expect(canTransition('awaiting_payment', 'cancelled')).toBe(true);
  });

  it('rejects released → cancelled', () => {
    expect(canTransition('released', 'cancelled')).toBe(false);
  });

  it('rejects cancelled → released', () => {
    expect(canTransition('cancelled', 'released')).toBe(false);
  });

  it('transitionOrder returns new status', () => {
    const result = transitionOrder('new', 'awaiting_payment');
    expect(result).toBe('awaiting_payment');
  });

  it('transitionOrder throws on invalid transition', () => {
    expect(() => transitionOrder('released', 'new')).toThrow('Invalid transition');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/modules/order-handler/lifecycle.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement lifecycle**

Create `src/modules/order-handler/lifecycle.ts`:

```typescript
import type { OrderStatus } from './types.js';

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['awaiting_payment', 'cancelled'],
  awaiting_payment: ['payment_marked', 'cancelled'],
  payment_marked: ['released', 'disputed'],
  released: [],
  cancelled: [],
  disputed: ['released', 'cancelled'],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionOrder(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
  return to;
}
```

- [ ] **Step 5: Run lifecycle test**

Run: `npx vitest run tests/modules/order-handler/lifecycle.test.ts`
Expected: 10 tests PASS.

- [ ] **Step 6: Implement OrderHandler**

Create `src/modules/order-handler/index.ts`:

```typescript
import type { EventBus, Side } from '../../event-bus.js';
import type { DB } from '../../db/index.js';
import type { BybitClient } from '../../bybit/client.js';
import { trades } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { transitionOrder } from './lifecycle.js';
import type { TrackedOrder, OrderStatus } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('order-handler');

export class OrderHandler {
  private bus: EventBus;
  private db: DB;
  private bybit: BybitClient;
  private trackedOrders: Map<string, TrackedOrder> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private autoCancelTimeoutMs: number;

  constructor(bus: EventBus, db: DB, bybit: BybitClient, autoCancelTimeoutMs = 900_000) {
    this.bus = bus;
    this.db = db;
    this.bybit = bybit;
    this.autoCancelTimeoutMs = autoCancelTimeoutMs;

    // Listen for Telegram actions
    this.bus.on('telegram:release', (payload) => {
      this.releaseOrder(payload.orderId);
    });
    this.bus.on('telegram:dispute', (payload) => {
      this.disputeOrder(payload.orderId);
    });
  }

  async syncPendingOrders(): Promise<void> {
    try {
      const pending = await this.bybit.getPendingOrders();
      for (const order of pending) {
        if (!this.trackedOrders.has(order.id)) {
          this.trackedOrders.set(order.id, {
            id: order.id,
            side: order.side,
            amount: order.amount,
            price: order.price,
            totalBob: order.totalBob,
            status: 'awaiting_payment',
            counterpartyId: order.counterpartyId,
            counterpartyName: order.counterpartyName,
            bankAccountId: 0,
            createdAt: order.createdAt,
            autoCancelAt: Date.now() + this.autoCancelTimeoutMs,
          });
          log.info({ orderId: order.id, side: order.side }, 'synced pending order from Bybit');
        }
      }
    } catch (err) {
      log.error({ err }, 'failed to sync pending orders');
    }
  }

  async poll(): Promise<void> {
    try {
      const pending = await this.bybit.getPendingOrders();
      const pendingIds = new Set(pending.map((o) => o.id));

      // Detect new orders
      for (const order of pending) {
        if (!this.trackedOrders.has(order.id)) {
          const tracked: TrackedOrder = {
            id: order.id,
            side: order.side,
            amount: order.amount,
            price: order.price,
            totalBob: order.totalBob,
            status: 'new',
            counterpartyId: order.counterpartyId,
            counterpartyName: order.counterpartyName,
            bankAccountId: 0,
            createdAt: order.createdAt,
            autoCancelAt: Date.now() + this.autoCancelTimeoutMs,
          };
          this.trackedOrders.set(order.id, tracked);
          tracked.status = transitionOrder('new', 'awaiting_payment');

          this.bus.emit('order:new', {
            orderId: order.id,
            side: order.side,
            amount: order.amount,
            price: order.price,
            counterparty: order.counterpartyName,
          }, 'order-handler');

          log.info({ orderId: order.id, side: order.side, amount: order.amount }, 'new order detected');
        } else {
          // Check for status changes (e.g., buyer marked payment)
          const tracked = this.trackedOrders.get(order.id)!;
          const bybitStatus = this.mapBybitStatus(order.status);
          if (bybitStatus === 'payment_marked' && tracked.status === 'awaiting_payment') {
            tracked.status = transitionOrder('awaiting_payment', 'payment_marked');
            this.bus.emit('order:payment-claimed', {
              orderId: order.id,
              amount: order.totalBob,
              bankAccount: '', // filled by Telegram module from context
            }, 'order-handler');
            log.info({ orderId: order.id }, 'payment claimed by counterparty');
          }
        }
      }

      // Detect completed/cancelled orders (disappeared from pending)
      for (const [orderId, tracked] of this.trackedOrders) {
        if (!pendingIds.has(orderId) && !['released', 'cancelled', 'disputed'].includes(tracked.status)) {
          // Order disappeared — check detail to know why
          try {
            const detail = await this.bybit.getOrderDetail(orderId);
            const finalStatus = this.mapBybitStatus(detail.status);
            if (finalStatus === 'released') {
              tracked.status = 'released';
              this.logTrade(tracked);
              this.bus.emit('order:released', {
                orderId,
                amount: tracked.amount,
                profit: 0, // calculated elsewhere
              }, 'order-handler');
            } else if (finalStatus === 'cancelled') {
              tracked.status = 'cancelled';
              this.bus.emit('order:cancelled', {
                orderId,
                reason: 'completed on Bybit',
              }, 'order-handler');
            }
          } catch (err) {
            log.error({ err, orderId }, 'failed to get order detail for disappeared order');
          }
        }
      }

      // Auto-cancel check
      const now = Date.now();
      for (const [orderId, tracked] of this.trackedOrders) {
        if (tracked.autoCancelAt && now > tracked.autoCancelAt && tracked.status === 'awaiting_payment') {
          log.warn({ orderId }, 'auto-cancel timeout reached');
          this.bus.emit('order:cancelled', { orderId, reason: 'auto-cancel timeout' }, 'order-handler');
          tracked.status = 'cancelled';
        }
      }
    } catch (err) {
      log.error({ err }, 'order poll failed');
    }
  }

  async markAsPaid(orderId: string): Promise<void> {
    await this.bybit.markOrderAsPaid(orderId);
    const tracked = this.trackedOrders.get(orderId);
    if (tracked) {
      tracked.status = transitionOrder(tracked.status, 'payment_marked');
    }
  }

  async releaseOrder(orderId: string): Promise<void> {
    try {
      await this.bybit.releaseOrder(orderId);
      const tracked = this.trackedOrders.get(orderId);
      if (tracked) {
        tracked.status = transitionOrder(tracked.status, 'released');
        this.logTrade(tracked);
        this.bus.emit('order:released', {
          orderId,
          amount: tracked.amount,
          profit: 0,
        }, 'order-handler');
        log.info({ orderId }, 'order released');
      }
    } catch (err) {
      log.error({ err, orderId }, 'RELEASE FAILED — requires manual action');
      throw err; // let caller (Telegram) handle notification
    }
  }

  private async disputeOrder(orderId: string): Promise<void> {
    const tracked = this.trackedOrders.get(orderId);
    if (tracked) {
      tracked.status = transitionOrder(tracked.status, 'disputed');
      this.bus.emit('order:disputed', { orderId, reason: 'user dispute' }, 'order-handler');
      log.warn({ orderId }, 'order disputed');
    }
  }

  private logTrade(order: TrackedOrder): void {
    this.db.insert(trades).values({
      bybitOrderId: order.id,
      side: order.side,
      amountUsdt: order.amount,
      priceBob: order.price,
      totalBob: order.totalBob,
      spreadCaptured: 0,
      counterpartyId: order.counterpartyId,
      counterpartyName: order.counterpartyName,
      bankAccountId: order.bankAccountId || null,
      status: 'completed',
      createdAt: order.createdAt,
      completedAt: Date.now(),
    }).run();
  }

  private mapBybitStatus(bybitStatus: string): OrderStatus {
    const map: Record<string, OrderStatus> = {
      '10': 'new',
      '20': 'awaiting_payment',
      '30': 'payment_marked',
      '40': 'released',
      '50': 'cancelled',
      '60': 'disputed',
    };
    return map[bybitStatus] || 'awaiting_payment';
  }

  getTrackedOrders(): TrackedOrder[] {
    return Array.from(this.trackedOrders.values());
  }

  getPendingCount(): number {
    return Array.from(this.trackedOrders.values())
      .filter((o) => !['released', 'cancelled'].includes(o.status)).length;
  }

  start(intervalMs: number): void {
    log.info({ intervalMs }, 'starting order handler');
    this.intervalId = setInterval(() => this.poll(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    log.info('order handler stopped');
  }
}
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/order-handler/ tests/modules/order-handler/
git commit -m "feat: OrderHandler with state machine, polling, auto-cancel, and Telegram integration"
```

---

## Task 11: EmergencyStop Module

**Files:**
- Create: `src/modules/emergency-stop/types.ts`
- Create: `src/modules/emergency-stop/index.ts`
- Test: `tests/modules/emergency-stop/index.test.ts`

- [ ] **Step 1: Create types**

Create `src/modules/emergency-stop/types.ts`:

```typescript
export type EmergencyTrigger = 'volatility' | 'spread_inversion' | 'stale_data' | 'manual';

export type BotState = 'running' | 'paused' | 'emergency';
```

- [ ] **Step 2: Write failing test**

Create `tests/modules/emergency-stop/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmergencyStop } from '../../../src/modules/emergency-stop/index.js';
import { EventBus } from '../../../src/event-bus.js';
import { createTestDB } from '../../../src/db/index.js';
import type { DB } from '../../../src/db/index.js';

describe('EmergencyStop', () => {
  let db: DB;
  let close: () => void;
  let bus: EventBus;
  let emergency: EmergencyStop;
  let mockRemoveAllAds: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const testDb = createTestDB();
    db = testDb.db;
    close = testDb.close;
    bus = new EventBus(db);
    mockRemoveAllAds = vi.fn().mockResolvedValue(undefined);
    emergency = new EmergencyStop(bus, db, {
      removeAllAds: mockRemoveAllAds,
      getExposure: () => ({ usdt: 1500, bob: 14000 }),
      getMarketState: () => ({ ask: 9.35, bid: 9.33 }),
      getPendingOrderCount: () => 2,
      stopPolling: vi.fn(),
      startPolling: vi.fn(),
    });
  });

  afterEach(() => {
    bus.removeAllListeners();
    close();
  });

  it('triggers on price:volatility-alert', () => {
    const handler = vi.fn();
    bus.on('emergency:triggered', handler);

    bus.emit('price:volatility-alert', {
      currentPrice: 9.60,
      previousPrice: 9.35,
      changePercent: 2.67,
      windowMinutes: 5,
    }, 'price-monitor');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'volatility' })
    );
    expect(mockRemoveAllAds).toHaveBeenCalled();
  });

  it('triggers on price:stale', () => {
    const handler = vi.fn();
    bus.on('emergency:triggered', handler);

    bus.emit('price:stale', { lastUpdate: Date.now() - 360000, staleDurationSeconds: 360 }, 'price-monitor');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'stale_data' })
    );
  });

  it('triggers on ad:spread-inversion', () => {
    const handler = vi.fn();
    bus.on('emergency:triggered', handler);

    bus.emit('ad:spread-inversion', { buyPrice: 9.40, sellPrice: 9.35 }, 'ad-manager');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'spread_inversion' })
    );
  });

  it('triggers on telegram:emergency', () => {
    const handler = vi.fn();
    bus.on('emergency:triggered', handler);

    bus.emit('telegram:emergency', {}, 'telegram');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'manual' })
    );
  });

  it('does not double-trigger when already in emergency state', () => {
    const handler = vi.fn();
    bus.on('emergency:triggered', handler);

    bus.emit('telegram:emergency', {}, 'telegram');
    bus.emit('telegram:emergency', {}, 'telegram');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('resolves on resume', () => {
    const handler = vi.fn();
    bus.on('emergency:resolved', handler);

    bus.emit('telegram:emergency', {}, 'telegram');
    emergency.resolve('user');

    expect(handler).toHaveBeenCalledWith({ resumedBy: 'user' });
    expect(emergency.getState()).toBe('running');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/modules/emergency-stop/index.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement EmergencyStop**

Create `src/modules/emergency-stop/index.ts`:

```typescript
import type { EventBus } from '../../event-bus.js';
import type { DB } from '../../db/index.js';
import type { BotState, EmergencyTrigger } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('emergency-stop');

interface EmergencyDeps {
  removeAllAds: () => Promise<void>;
  getExposure: () => { usdt: number; bob: number };
  getMarketState: () => { ask: number; bid: number };
  getPendingOrderCount: () => number;
  stopPolling: () => void;
  startPolling: () => void;
}

export class EmergencyStop {
  private bus: EventBus;
  private db: DB;
  private deps: EmergencyDeps;
  private state: BotState = 'running';

  constructor(bus: EventBus, db: DB, deps: EmergencyDeps) {
    this.bus = bus;
    this.db = db;
    this.deps = deps;

    this.bus.on('price:volatility-alert', (payload) => {
      this.trigger('volatility', `Price moved ${payload.changePercent.toFixed(2)}% in ${payload.windowMinutes} min`);
    });

    this.bus.on('price:stale', (payload) => {
      this.trigger('stale_data', `No price update for ${payload.staleDurationSeconds}s`);
    });

    this.bus.on('ad:spread-inversion', (payload) => {
      this.trigger('spread_inversion', `Buy ${payload.buyPrice} >= Sell ${payload.sellPrice}`);
    });

    this.bus.on('telegram:emergency', () => {
      this.trigger('manual', 'Manual emergency stop');
    });
  }

  private async trigger(triggerType: EmergencyTrigger, reason: string): Promise<void> {
    if (this.state === 'emergency') {
      log.debug('already in emergency state, ignoring trigger');
      return;
    }

    this.state = 'emergency';
    log.warn({ trigger: triggerType, reason }, 'EMERGENCY STOP TRIGGERED');

    // Remove all ads
    try {
      await this.deps.removeAllAds();
    } catch (err) {
      log.error({ err }, 'failed to remove ads during emergency');
    }

    // Stop non-essential polling
    this.deps.stopPolling();

    const exposure = this.deps.getExposure();
    const marketState = this.deps.getMarketState();

    this.bus.emit('emergency:triggered', {
      reason,
      trigger: triggerType,
      marketState,
      exposure,
    }, 'emergency-stop');
  }

  resolve(resumedBy: string): void {
    if (this.state !== 'emergency') return;
    this.state = 'running';
    this.deps.startPolling();
    this.bus.emit('emergency:resolved', { resumedBy }, 'emergency-stop');
    log.info({ resumedBy }, 'emergency resolved');
  }

  getState(): BotState {
    return this.state;
  }

  setState(state: BotState): void {
    this.state = state;
  }
}
```

- [ ] **Step 5: Run test**

Run: `npx vitest run tests/modules/emergency-stop/index.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/emergency-stop/ tests/modules/emergency-stop/
git commit -m "feat: EmergencyStop module with volatility, stale data, and inversion triggers"
```

---

## Task 12: Telegram Bot Module

**Files:**
- Create: `src/modules/telegram/keyboards.ts`
- Create: `src/modules/telegram/alerts.ts`
- Create: `src/modules/telegram/commands.ts`
- Create: `src/modules/telegram/index.ts`
- Test: `tests/modules/telegram/alerts.test.ts`

- [ ] **Step 1: Create inline keyboards**

Create `src/modules/telegram/keyboards.ts`:

```typescript
import { InlineKeyboard } from 'grammy';

export function confirmReleaseKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Confirm & Release', `release:${orderId}`)
    .text('Dispute', `dispute:${orderId}`);
}

export function markAsPaidKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Mark as Paid', `paid:${orderId}`);
}
```

- [ ] **Step 2: Write failing test for alerts**

Create `tests/modules/telegram/alerts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatOrderNew, formatOrderReleased, formatEmergency } from '../../../src/modules/telegram/alerts.js';

describe('Telegram alerts', () => {
  it('formats new order alert', () => {
    const msg = formatOrderNew({
      orderId: '456', side: 'buy', amount: 500, price: 9.33, counterparty: 'trader1',
    });
    expect(msg).toContain('456');
    expect(msg).toContain('BUY');
    expect(msg).toContain('500');
    expect(msg).toContain('9.33');
    expect(msg).toContain('trader1');
  });

  it('formats order released alert', () => {
    const msg = formatOrderReleased({ orderId: '789', amount: 500, profit: 10 });
    expect(msg).toContain('789');
    expect(msg).toContain('500');
    expect(msg).toContain('10');
  });

  it('formats emergency alert with exposure', () => {
    const msg = formatEmergency({
      reason: 'Price moved 3% in 5 min',
      trigger: 'volatility',
      marketState: { ask: 9.60, bid: 9.55 },
      exposure: { usdt: 1500, bob: 14000 },
      pendingOrders: 2,
    });
    expect(msg).toContain('EMERGENCY');
    expect(msg).toContain('volatility');
    expect(msg).toContain('1500');
    expect(msg).toContain('14000');
    expect(msg).toContain('2');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/modules/telegram/alerts.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement alerts**

Create `src/modules/telegram/alerts.ts`:

```typescript
import type { Side } from '../../event-bus.js';
import type { EmergencyTrigger } from '../emergency-stop/types.js';

export function formatOrderNew(data: {
  orderId: string; side: Side; amount: number; price: number; counterparty: string;
}): string {
  const sideLabel = data.side.toUpperCase();
  const totalBob = (data.amount * data.price).toFixed(2);
  return [
    `📋 *New ${sideLabel} Order #${data.orderId}*`,
    `Amount: ${data.amount} USDT @ ${data.price} BOB`,
    `Total: ${totalBob} BOB`,
    `Counterparty: ${data.counterparty}`,
  ].join('\n');
}

export function formatPaymentClaimed(data: {
  orderId: string; amount: number; bankAccount: string;
}): string {
  return [
    `💰 *Payment Claimed — Order #${data.orderId}*`,
    `Amount: ${data.amount} BOB`,
    `Check your bank account and confirm below.`,
  ].join('\n');
}

export function formatOrderReleased(data: {
  orderId: string; amount: number; profit: number;
}): string {
  return [
    `✅ *Order #${data.orderId} Completed*`,
    `Amount: ${data.amount} USDT`,
    `Spread profit: ${data.profit} BOB`,
  ].join('\n');
}

export function formatOrderCancelled(data: { orderId: string; reason: string }): string {
  return `❌ *Order #${data.orderId} Cancelled*\nReason: ${data.reason}`;
}

export function formatAdPaused(data: { side: Side; reason: string }): string {
  return `⏸️ Ad paused (${data.side}): ${data.reason}`;
}

export function formatLowBalance(data: { accountId: number; balance: number; name?: string }): string {
  return `⚠️ Low balance on ${data.name || `account #${data.accountId}`}: ${data.balance.toFixed(2)} BOB`;
}

export function formatEmergency(data: {
  reason: string;
  trigger: EmergencyTrigger;
  marketState: { ask: number; bid: number };
  exposure: { usdt: number; bob: number };
  pendingOrders: number;
}): string {
  const total = data.exposure.usdt * ((data.marketState.ask + data.marketState.bid) / 2) + data.exposure.bob;
  const usdtPct = total > 0 ? ((data.exposure.usdt * ((data.marketState.ask + data.marketState.bid) / 2)) / total * 100).toFixed(0) : '0';
  const bobPct = total > 0 ? ((data.exposure.bob / total) * 100).toFixed(0) : '0';

  const skew = parseInt(usdtPct) > 60 ? 'heavy USDT' : parseInt(bobPct) > 60 ? 'heavy BOB' : 'balanced';

  return [
    `🚨 *EMERGENCY STOP*`,
    ``,
    `Trigger: *${data.trigger}*`,
    `Reason: ${data.reason}`,
    `Market: ask ${data.marketState.ask} / bid ${data.marketState.bid}`,
    ``,
    `*Your exposure:*`,
    `  USDT: ${data.exposure.usdt} (${usdtPct}%)`,
    `  BOB: ${data.exposure.bob.toFixed(0)} (${bobPct}%)`,
    `  Skew: ${skew}`,
    ``,
    `Pending orders: ${data.pendingOrders} (still active)`,
    ``,
    `Review and /resume when ready.`,
  ].join('\n');
}

export function formatBotStarted(data: {
  activeSides: string; minSpread: string; maxSpread: string; accountCount: number;
}): string {
  return [
    `🟢 *Bot Started*`,
    `Sides: ${data.activeSides}`,
    `Spread: ${data.minSpread} - ${data.maxSpread}`,
    `Bank accounts: ${data.accountCount} active`,
  ].join('\n');
}

export function formatBotStopping(pendingOrders: number): string {
  return `🔴 *Bot Stopping*\n${pendingOrders} pending orders need manual handling.`;
}
```

- [ ] **Step 5: Run alerts test**

Run: `npx vitest run tests/modules/telegram/alerts.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 6: Implement commands**

Create `src/modules/telegram/commands.ts`:

```typescript
import type { Context } from 'grammy';

export interface CommandDeps {
  getStatus: () => { state: string; uptime: number; activeAds: number; pendingOrders: number };
  getBalances: () => { accounts: Array<{ name: string; bank: string; balance: number; dailyVolume: number; dailyLimit: number; status: string }> };
  getProfit: () => { today: number; week: number; month: number; todayTrades: number };
  getAds: () => Array<{ side: string; price: number; status: string }>;
  getOrders: () => Array<{ id: string; side: string; amount: number; status: string }>;
  pause: (side?: string) => void;
  resume: () => void;
  setConfig: (key: string, value: string) => void;
  triggerEmergency: () => void;
  markAsPaid: (orderId: string) => Promise<void>;
  releaseOrder: (orderId: string) => Promise<void>;
  cancelOrder: (orderId: string) => void;
  setBalance: (accountName: string, balance: number) => void;
}

export function registerCommands(deps: CommandDeps) {
  return {
    async status(ctx: Context) {
      const s = deps.getStatus();
      const uptimeMin = Math.floor(s.uptime / 60000);
      await ctx.reply(
        `*Status:* ${s.state}\n*Uptime:* ${uptimeMin} min\n*Active ads:* ${s.activeAds}\n*Pending orders:* ${s.pendingOrders}`,
        { parse_mode: 'Markdown' },
      );
    },

    async balance(ctx: Context) {
      const args = ctx.message?.text?.split(' ').slice(1) || [];
      if (args.length === 2) {
        // Set balance: /balance banco-union 15000
        deps.setBalance(args[0], parseFloat(args[1]));
        await ctx.reply(`Balance updated: ${args[0]} = ${args[1]} BOB`);
        return;
      }
      const b = deps.getBalances();
      const lines = b.accounts.map((a) =>
        `${a.status === 'active' ? '🟢' : '🔴'} *${a.name}* (${a.bank})\n  Balance: ${a.balance.toFixed(0)} BOB | Daily: ${a.dailyVolume.toFixed(0)}/${a.dailyLimit.toFixed(0)}`
      );
      await ctx.reply(lines.join('\n\n') || 'No bank accounts configured.', { parse_mode: 'Markdown' });
    },

    async profit(ctx: Context) {
      const p = deps.getProfit();
      await ctx.reply(
        `*P&L*\nToday: ${p.today.toFixed(2)} BOB (${p.todayTrades} trades)\n7d: ${p.week.toFixed(2)} BOB\n30d: ${p.month.toFixed(2)} BOB`,
        { parse_mode: 'Markdown' },
      );
    },

    async ads(ctx: Context) {
      const a = deps.getAds();
      if (a.length === 0) {
        await ctx.reply('No active ads.');
        return;
      }
      const lines = a.map((ad) => `${ad.side.toUpperCase()}: ${ad.price} BOB (${ad.status})`);
      await ctx.reply(lines.join('\n'));
    },

    async orders(ctx: Context) {
      const o = deps.getOrders();
      if (o.length === 0) {
        await ctx.reply('No pending orders.');
        return;
      }
      const lines = o.map((ord) => `#${ord.id} ${ord.side.toUpperCase()} ${ord.amount} USDT — ${ord.status}`);
      await ctx.reply(lines.join('\n'));
    },

    async pause(ctx: Context) {
      const args = ctx.message?.text?.split(' ').slice(1) || [];
      deps.pause(args[0]); // undefined = pause both
      await ctx.reply(`Trading paused${args[0] ? ` (${args[0]} side)` : ''}.`);
    },

    async resume(ctx: Context) {
      deps.resume();
      await ctx.reply('Trading resumed.');
    },

    async setMinSpread(ctx: Context) {
      const val = ctx.message?.text?.split(' ')[1];
      if (!val) { await ctx.reply('Usage: /set_min_spread <value>'); return; }
      deps.setConfig('min_spread', val);
      await ctx.reply(`Min spread set to ${val}`);
    },

    async setMaxSpread(ctx: Context) {
      const val = ctx.message?.text?.split(' ')[1];
      if (!val) { await ctx.reply('Usage: /set_max_spread <value>'); return; }
      deps.setConfig('max_spread', val);
      await ctx.reply(`Max spread set to ${val}`);
    },

    async setAmount(ctx: Context) {
      const val = ctx.message?.text?.split(' ')[1];
      if (!val) { await ctx.reply('Usage: /set_amount <value>'); return; }
      deps.setConfig('trade_amount_usdt', val);
      await ctx.reply(`Trade amount set to ${val} USDT`);
    },

    async emergency(ctx: Context) {
      deps.triggerEmergency();
      await ctx.reply('Emergency stop triggered.');
    },

    async setVolatilityThreshold(ctx: Context) {
      const val = ctx.message?.text?.split(' ')[1];
      if (!val) { await ctx.reply('Usage: /set_volatility_threshold <percent>'); return; }
      deps.setConfig('volatility_threshold_percent', val);
      await ctx.reply(`Volatility threshold set to ${val}%`);
    },

    async setVolatilityWindow(ctx: Context) {
      const val = ctx.message?.text?.split(' ')[1];
      if (!val) { await ctx.reply('Usage: /set_volatility_window <minutes>'); return; }
      deps.setConfig('volatility_window_minutes', val);
      await ctx.reply(`Volatility window set to ${val} min`);
    },

    async release(ctx: Context) {
      const orderId = ctx.message?.text?.split(' ')[1];
      if (!orderId) { await ctx.reply('Usage: /release <orderId>'); return; }
      try {
        await deps.releaseOrder(orderId);
        await ctx.reply(`Order ${orderId} released.`);
      } catch (err) {
        await ctx.reply(`Release failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async cancel(ctx: Context) {
      const orderId = ctx.message?.text?.split(' ')[1];
      if (!orderId) { await ctx.reply('Usage: /cancel <orderId>'); return; }
      deps.cancelOrder(orderId);
      await ctx.reply(`Order ${orderId} cancelled.`);
    },
  };
}
```

- [ ] **Step 7: Implement TelegramBot**

Create `src/modules/telegram/index.ts`:

```typescript
import { Bot } from 'grammy';
import type { EventBus } from '../../event-bus.js';
import type { DB } from '../../db/index.js';
import { registerCommands, type CommandDeps } from './commands.js';
import { confirmReleaseKeyboard, markAsPaidKeyboard } from './keyboards.js';
import * as alerts from './alerts.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('telegram');

export class TelegramBot {
  private bot: Bot;
  private bus: EventBus;
  private db: DB;
  private chatId: string;

  constructor(bus: EventBus, db: DB, botToken: string, chatId: string, deps: CommandDeps) {
    this.bus = bus;
    this.db = db;
    this.chatId = chatId;
    this.bot = new Bot(botToken);

    // Register commands
    const cmds = registerCommands(deps);
    this.bot.command('status', cmds.status);
    this.bot.command('balance', cmds.balance);
    this.bot.command('profit', cmds.profit);
    this.bot.command('ads', cmds.ads);
    this.bot.command('orders', cmds.orders);
    this.bot.command('pause', cmds.pause);
    this.bot.command('pause_buy', (ctx) => { deps.pause('buy'); ctx.reply('Buy side paused.'); });
    this.bot.command('pause_sell', (ctx) => { deps.pause('sell'); ctx.reply('Sell side paused.'); });
    this.bot.command('resume', cmds.resume);
    this.bot.command('set_min_spread', cmds.setMinSpread);
    this.bot.command('set_max_spread', cmds.setMaxSpread);
    this.bot.command('set_amount', cmds.setAmount);
    this.bot.command('emergency', cmds.emergency);
    this.bot.command('set_volatility_threshold', cmds.setVolatilityThreshold);
    this.bot.command('set_volatility_window', cmds.setVolatilityWindow);
    this.bot.command('release', cmds.release);
    this.bot.command('cancel', cmds.cancel);

    // Handle inline keyboard callbacks
    this.bot.callbackQuery(/^release:(.+)$/, async (ctx) => {
      const orderId = ctx.match![1];
      this.bus.emit('telegram:release', { orderId }, 'telegram');
      await ctx.answerCallbackQuery('Releasing...');
      await ctx.editMessageText(`Order #${orderId} — release confirmed.`);
    });

    this.bot.callbackQuery(/^dispute:(.+)$/, async (ctx) => {
      const orderId = ctx.match![1];
      this.bus.emit('telegram:dispute', { orderId }, 'telegram');
      await ctx.answerCallbackQuery('Dispute opened.');
      await ctx.editMessageText(`Order #${orderId} — disputed.`);
    });

    this.bot.callbackQuery(/^paid:(.+)$/, async (ctx) => {
      const orderId = ctx.match![1];
      try {
        await deps.markAsPaid(orderId);
        await ctx.answerCallbackQuery('Marked as paid.');
        await ctx.editMessageText(`Order #${orderId} — marked as paid. Waiting for counterparty to release.`);
      } catch (err) {
        await ctx.answerCallbackQuery('Failed to mark as paid.');
      }
    });

    // Subscribe to events for alerts
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.bus.on('order:new', (payload) => {
      const msg = alerts.formatOrderNew(payload);
      const keyboard = payload.side === 'buy'
        ? markAsPaidKeyboard(payload.orderId)
        : undefined;
      this.send(msg, keyboard);
    });

    this.bus.on('order:payment-claimed', (payload) => {
      const msg = alerts.formatPaymentClaimed(payload);
      this.send(msg, confirmReleaseKeyboard(payload.orderId));
    });

    this.bus.on('order:released', (payload) => {
      this.send(alerts.formatOrderReleased(payload));
    });

    this.bus.on('order:cancelled', (payload) => {
      this.send(alerts.formatOrderCancelled(payload));
    });

    this.bus.on('ad:paused', (payload) => {
      this.send(alerts.formatAdPaused(payload));
    });

    this.bus.on('bank:low-balance', (payload) => {
      this.send(alerts.formatLowBalance(payload));
    });

    this.bus.on('emergency:triggered', (payload) => {
      this.send(alerts.formatEmergency({
        ...payload,
        pendingOrders: 0, // will be filled from deps
      }));
    });

    this.bus.on('emergency:resolved', () => {
      this.send('🟢 *Emergency resolved.* Trading resumed. Ads being recreated.');
    });
  }

  private async send(text: string, keyboard?: any): Promise<void> {
    try {
      await this.bot.api.sendMessage(this.chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err) {
      log.error({ err }, 'failed to send Telegram message');
    }
  }

  async start(): Promise<void> {
    log.info('starting Telegram bot');
    this.bot.start({
      onStart: () => log.info('Telegram bot polling started'),
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    log.info('Telegram bot stopped');
  }

  async sendStartupMessage(data: Parameters<typeof alerts.formatBotStarted>[0]): Promise<void> {
    await this.send(alerts.formatBotStarted(data));
  }

  async sendShutdownMessage(pendingOrders: number): Promise<void> {
    await this.send(alerts.formatBotStopping(pendingOrders));
  }
}
```

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/telegram/ tests/modules/telegram/
git commit -m "feat: Telegram bot with commands, alerts, inline keyboards, and event listeners"
```

---

## Task 13: Main Entry Point — Wiring + Startup/Shutdown

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Implement main entry point**

Replace `src/index.ts`:

```typescript
import 'dotenv/config';
import { envConfig, DEFAULT_CONFIG, type ConfigKey } from './config.js';
import { createDB, schema } from './db/index.js';
import { EventBus } from './event-bus.js';
import { BybitClient } from './bybit/client.js';
import { CriptoYaClient } from './modules/price-monitor/criptoya.js';
import { PriceMonitor } from './modules/price-monitor/index.js';
import { BankManager } from './modules/bank-manager/index.js';
import { AdManager } from './modules/ad-manager/index.js';
import { OrderHandler } from './modules/order-handler/index.js';
import { EmergencyStop } from './modules/emergency-stop/index.js';
import { TelegramBot } from './modules/telegram/index.js';
import { createModuleLogger } from './utils/logger.js';
import { eq, sql, gte } from 'drizzle-orm';

const log = createModuleLogger('main');
const startTime = Date.now();

// --- Initialize infrastructure ---
const db = createDB(envConfig.db.path);
const bus = new EventBus(db);

// Seed default config
for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
  const existing = db.select().from(schema.config).where(eq(schema.config.key, key)).get();
  if (!existing) {
    db.insert(schema.config).values({ key, value, updatedAt: Date.now() }).run();
  }
}

function getConfig(key: ConfigKey): string {
  const row = db.select().from(schema.config).where(eq(schema.config.key, key)).get();
  return row?.value ?? DEFAULT_CONFIG[key];
}

function setConfig(key: string, value: string): void {
  db.insert(schema.config)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: schema.config.key, set: { value, updatedAt: Date.now() } })
    .run();
}

// --- Initialize external clients ---
const bybit = new BybitClient(envConfig.bybit.apiKey, envConfig.bybit.apiSecret, envConfig.bybit.testnet);
const criptoya = new CriptoYaClient();

// --- Initialize modules ---
const bankManager = new BankManager(bus, db);

const priceMonitor = new PriceMonitor(bus, db, criptoya, {
  volatilityThresholdPercent: parseFloat(getConfig('volatility_threshold_percent')),
  volatilityWindowMinutes: parseFloat(getConfig('volatility_window_minutes')),
});

const adManager = new AdManager(
  bus, db, bybit,
  {
    minSpread: parseFloat(getConfig('min_spread')),
    maxSpread: parseFloat(getConfig('max_spread')),
    tradeAmountUsdt: parseFloat(getConfig('trade_amount_usdt')),
  },
  (side, amount) => {
    const account = bankManager.selectAccount({ minBalance: amount, side });
    return account ? { id: account.id, name: account.name } : null;
  },
);

const orderHandler = new OrderHandler(
  bus, db, bybit,
  parseInt(getConfig('auto_cancel_timeout_ms')),
);

// Update bank balance on completed trades
bus.on('order:released', (payload) => {
  // This is a simplified balance update — in production you'd track which bank account
  // was used per order and update accordingly
  log.info({ orderId: payload.orderId, amount: payload.amount }, 'trade completed');
});

function stopPolling(): void {
  priceMonitor.stop();
  adManager.stop();
}

function startPolling(): void {
  priceMonitor.start(parseInt(getConfig('poll_interval_prices_ms')));
  adManager.start(parseInt(getConfig('poll_interval_ads_ms')));
}

const emergencyStop = new EmergencyStop(bus, db, {
  removeAllAds: () => adManager.removeAllAds(),
  getExposure: () => {
    const bob = bankManager.getTotalBobBalance();
    // USDT balance would come from Bybit — simplified here
    return { usdt: 0, bob };
  },
  getMarketState: () => priceMonitor.getBybitPrices() || { ask: 0, bid: 0 },
  getPendingOrderCount: () => orderHandler.getPendingCount(),
  stopPolling,
  startPolling,
});

const telegramBot = new TelegramBot(bus, db, envConfig.telegram.botToken, envConfig.telegram.chatId, {
  getStatus: () => ({
    state: emergencyStop.getState(),
    uptime: Date.now() - startTime,
    activeAds: adManager.getActiveAds().size,
    pendingOrders: orderHandler.getPendingCount(),
  }),
  getBalances: () => ({
    accounts: bankManager.getAccounts().map((a) => ({
      name: a.name,
      bank: a.bank,
      balance: a.balanceBob,
      dailyVolume: a.dailyVolume,
      dailyLimit: a.dailyLimit,
      status: a.status,
    })),
  }),
  getProfit: () => {
    const today = new Date().toISOString().split('T')[0];
    const todayRow = db.select().from(schema.dailyPnl).where(eq(schema.dailyPnl.date, today)).get();
    // Simplified — full implementation would aggregate from trades table
    return {
      today: todayRow?.profitBob ?? 0,
      week: 0,
      month: 0,
      todayTrades: todayRow?.tradesCount ?? 0,
    };
  },
  getAds: () => {
    const active = adManager.getActiveAds();
    return Array.from(active.values()).map((a) => ({
      side: a.side,
      price: a.price,
      status: 'active',
    }));
  },
  getOrders: () => orderHandler.getTrackedOrders().map((o) => ({
    id: o.id,
    side: o.side,
    amount: o.amount,
    status: o.status,
  })),
  pause: (side?: string) => {
    if (side === 'buy' || side === 'sell') {
      adManager.setPaused(side, true);
    } else {
      adManager.setPaused('both', true);
    }
    setConfig('bot_state', 'paused');
  },
  resume: () => {
    adManager.setPaused('both', false);
    emergencyStop.resolve('telegram');
    setConfig('bot_state', 'running');
  },
  setConfig: (key, value) => {
    setConfig(key, value);
    // Propagate config changes to modules
    if (key === 'min_spread' || key === 'max_spread' || key === 'trade_amount_usdt') {
      adManager.updateConfig({
        minSpread: parseFloat(getConfig('min_spread')),
        maxSpread: parseFloat(getConfig('max_spread')),
        tradeAmountUsdt: parseFloat(getConfig('trade_amount_usdt')),
      });
    }
  },
  triggerEmergency: () => {
    bus.emit('telegram:emergency', {}, 'telegram');
  },
  markAsPaid: (orderId) => orderHandler.markAsPaid(orderId),
  releaseOrder: (orderId) => orderHandler.releaseOrder(orderId),
  cancelOrder: (orderId) => {
    bus.emit('order:cancelled', { orderId, reason: 'cancelled by user' }, 'telegram');
  },
  setBalance: (accountName, balance) => {
    const account = bankManager.getAccounts().find(
      (a) => a.name.toLowerCase().includes(accountName.toLowerCase()) || a.bank.includes(accountName)
    );
    if (account) {
      bankManager.setBalance(account.id, balance);
    }
  },
});

// --- Startup sequence ---
async function start(): Promise<void> {
  log.info('starting bot...');

  // 1. Load bank accounts
  await bankManager.loadAccounts();

  // 2. Fetch initial prices
  await priceMonitor.fetchOnce();

  // 3. Sync existing state from Bybit
  await adManager.syncExistingAds();
  await orderHandler.syncPendingOrders();

  // 4. Start Telegram bot
  await telegramBot.start();

  // 5. Start polling loops
  orderHandler.start(parseInt(getConfig('poll_interval_orders_ms')));
  startPolling();

  // 6. Startup notification
  await telegramBot.sendStartupMessage({
    activeSides: getConfig('active_sides'),
    minSpread: getConfig('min_spread'),
    maxSpread: getConfig('max_spread'),
    accountCount: bankManager.getAccounts().filter((a) => a.status === 'active').length,
  });

  // Daily reset job (midnight)
  scheduleDailyReset();

  log.info('bot started successfully');
}

function scheduleDailyReset(): void {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(() => {
    bankManager.resetDailyVolumes();
    log.info('daily volumes reset');
    scheduleDailyReset(); // reschedule for next midnight
  }, msUntilMidnight);
}

// --- Graceful shutdown ---
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down...');

  // 1. Stop polling
  orderHandler.stop();
  priceMonitor.stop();
  adManager.stop();

  // 2. Remove ads
  try {
    await adManager.removeAllAds();
  } catch (err) {
    log.error({ err }, 'failed to remove ads during shutdown');
  }

  // 3. Notify
  const pendingCount = orderHandler.getPendingCount();
  await telegramBot.sendShutdownMessage(pendingCount);

  // 4. Stop Telegram
  await telegramBot.stop();

  log.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  log.error({ err }, 'unhandled rejection');
});

// --- Go ---
start().catch((err) => {
  log.error({ err }, 'failed to start');
  process.exit(1);
});
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: main entry point with module wiring, startup sequence, and graceful shutdown"
```

---

## Task 14: End-to-End Smoke Test

**Files:**
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Write smoke test**

Create `tests/smoke.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../src/event-bus.js';
import { createTestDB, schema } from '../src/db/index.js';
import type { DB } from '../src/db/index.js';
import { PriceMonitor } from '../src/modules/price-monitor/index.js';
import { BankManager } from '../src/modules/bank-manager/index.js';
import { EmergencyStop } from '../src/modules/emergency-stop/index.js';
import { calculatePricing } from '../src/modules/ad-manager/pricing.js';

describe('Smoke test: full event flow', () => {
  let db: DB;
  let close: () => void;
  let bus: EventBus;

  beforeEach(() => {
    const testDb = createTestDB();
    db = testDb.db;
    close = testDb.close;
    bus = new EventBus(db);

    // Seed bank account
    db.insert(schema.bankAccounts).values({
      name: 'Banco Union',
      bank: 'banco-union',
      accountHint: '4521',
      balanceBob: 15000,
      dailyLimit: 50000,
      priority: 10,
      updatedAt: Date.now(),
    }).run();
  });

  afterEach(() => {
    bus.removeAllListeners();
    close();
  });

  it('price update flows through to pricing calculation', async () => {
    const mockClient = {
      getUsdtBobPrices: vi.fn().mockResolvedValue([
        { platform: 'bybitp2p', ask: 9.35, totalAsk: 9.35, bid: 9.33, totalBid: 9.33, time: 1000 },
        { platform: 'binancep2p', ask: 9.37, totalAsk: 9.37, bid: 9.34, totalBid: 9.34, time: 1000 },
      ]),
      getFees: vi.fn(),
    };
    const monitor = new PriceMonitor(bus, db, mockClient as any);

    let receivedPrices: any = null;
    bus.on('price:updated', (payload) => { receivedPrices = payload; });

    await monitor.fetchOnce();

    expect(receivedPrices).not.toBeNull();
    expect(receivedPrices.prices).toHaveLength(2);

    // Use prices in pricing calculation
    const pricing = calculatePricing(receivedPrices.prices, {
      minSpread: 0.015,
      maxSpread: 0.05,
      tradeAmountUsdt: 500,
    });

    expect(pricing.buyPrice).toBeGreaterThan(0);
    expect(pricing.sellPrice).toBeGreaterThan(pricing.buyPrice);
    expect(pricing.paused.buy).toBe(false);
    expect(pricing.paused.sell).toBe(false);
  });

  it('bank manager selects account and tracks balance', async () => {
    const bankManager = new BankManager(bus, db);
    await bankManager.loadAccounts();

    const account = bankManager.selectAccount({ minBalance: 5000, side: 'buy' });
    expect(account).not.toBeNull();
    expect(account!.name).toBe('Banco Union');

    // Simulate trade: spent 4675 BOB
    bankManager.updateBalanceAfterTrade(account!.id, -4675);
    expect(bankManager.getAccounts()[0].balanceBob).toBe(15000 - 4675);
  });

  it('emergency stop halts on volatility', async () => {
    const mockRemoveAds = vi.fn().mockResolvedValue(undefined);
    const emergency = new EmergencyStop(bus, db, {
      removeAllAds: mockRemoveAds,
      getExposure: () => ({ usdt: 1500, bob: 14000 }),
      getMarketState: () => ({ ask: 9.60, bid: 9.55 }),
      getPendingOrderCount: () => 0,
      stopPolling: vi.fn(),
      startPolling: vi.fn(),
    });

    const triggered = vi.fn();
    bus.on('emergency:triggered', triggered);

    // Simulate volatility alert
    bus.emit('price:volatility-alert', {
      currentPrice: 9.60,
      previousPrice: 9.35,
      changePercent: 2.67,
      windowMinutes: 5,
    }, 'price-monitor');

    expect(triggered).toHaveBeenCalledTimes(1);
    expect(emergency.getState()).toBe('emergency');
    expect(mockRemoveAds).toHaveBeenCalled();

    // Resolve
    emergency.resolve('user');
    expect(emergency.getState()).toBe('running');
  });

  it('events are persisted to event_log', () => {
    bus.emit('order:new', {
      orderId: 'test-123',
      side: 'buy' as const,
      amount: 500,
      price: 9.33,
      counterparty: 'tester',
    }, 'test');

    const logs = db.select().from(schema.eventLog).all();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const orderLog = logs.find((l) => l.eventType === 'order:new');
    expect(orderLog).toBeDefined();
    expect(JSON.parse(orderLog!.payload).orderId).toBe('test-123');
  });
});
```

- [ ] **Step 2: Run smoke test**

Run: `npx vitest run tests/smoke.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/smoke.test.ts
git commit -m "feat: end-to-end smoke test verifying full event flow"
```

- [ ] **Step 5: Final typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Final commit with all files**

```bash
git add -A
git commit -m "chore: project complete — P2P BOB/USDT market-making bot v0.1.0"
```
