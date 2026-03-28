import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { TABLE_DEFINITIONS } from '../src/db/index.js';

type DB = ReturnType<typeof drizzle>;

let sqlite: InstanceType<typeof Database>;
let db: DB;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(TABLE_DEFINITIONS);
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
});

describe('config table', () => {
  it('should insert and read config', async () => {
    await db.insert(schema.config).values({ key: 'spread_pct', value: '1.5' });
    const rows = await db.select().from(schema.config).where(eq(schema.config.key, 'spread_pct'));
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('spread_pct');
    expect(rows[0].value).toBe('1.5');
  });
});

describe('bank_accounts table', () => {
  it('should insert and read bank accounts', async () => {
    await db.insert(schema.bankAccounts).values({
      name: 'Test Account',
      bank: 'Banesco',
      accountHint: '****1234',
      balanceBob: 1000.0,
      dailyVolume: 0.0,
      dailyLimit: 5000.0,
      monthlyVolume: 0.0,
      status: 'active',
      priority: 1,
    });
    const rows = await db.select().from(schema.bankAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Test Account');
    expect(rows[0].bank).toBe('Banesco');
    expect(rows[0].status).toBe('active');
  });
});

describe('trades table', () => {
  it('should insert and read trades with FK to bank_accounts', async () => {
    const [account] = await db
      .insert(schema.bankAccounts)
      .values({
        name: 'Test Account',
        bank: 'Banesco',
        accountHint: '****1234',
        balanceBob: 1000.0,
        dailyVolume: 0.0,
        dailyLimit: 5000.0,
        monthlyVolume: 0.0,
        status: 'active',
        priority: 1,
      })
      .returning();

    await db.insert(schema.trades).values({
      bybitOrderId: 'ORDER123',
      side: 'buy',
      amountUsdt: 100.0,
      priceBob: 36.5,
      totalBob: 3650.0,
      spreadCaptured: 0.5,
      counterpartyId: 'CP001',
      counterpartyName: 'John Doe',
      bankAccountId: account.id,
      status: 'completed',
    });

    const rows = await db.select().from(schema.trades).where(eq(schema.trades.bybitOrderId, 'ORDER123'));
    expect(rows).toHaveLength(1);
    expect(rows[0].bybitOrderId).toBe('ORDER123');
    expect(rows[0].side).toBe('buy');
    expect(rows[0].bankAccountId).toBe(account.id);
    expect(rows[0].status).toBe('completed');
  });
});

describe('event_log table', () => {
  it('should insert and read event log entries', async () => {
    await db.insert(schema.eventLog).values({
      eventType: 'trade_completed',
      payload: JSON.stringify({ orderId: 'ORDER123', amount: 100 }),
      module: 'OrderHandler',
    });

    const rows = await db.select().from(schema.eventLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('trade_completed');
    expect(rows[0].module).toBe('OrderHandler');
    const payload = JSON.parse(rows[0].payload ?? '{}');
    expect(payload.orderId).toBe('ORDER123');
  });
});
