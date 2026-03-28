import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('db');

export const TABLE_DEFINITIONS = `
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
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
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bybit_order_id TEXT UNIQUE NOT NULL,
  side TEXT NOT NULL,
  amount_usdt REAL NOT NULL,
  price_bob REAL NOT NULL,
  total_bob REAL NOT NULL,
  spread_captured REAL,
  counterparty_id TEXT,
  counterparty_name TEXT,
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
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
  payload TEXT,
  timestamp TEXT DEFAULT (datetime('now')),
  module TEXT
);
`.trim();

export type DB = ReturnType<typeof drizzle>;

export { schema };

export function createDB(dbPath: string): DB {
  log.info({ dbPath }, 'Opening SQLite database');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(TABLE_DEFINITIONS);
  log.info('Database tables created/verified');
  return drizzle(sqlite, { schema });
}

export function createTestDB(): { db: DB; close: () => void } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(TABLE_DEFINITIONS);
  const db = drizzle(sqlite, { schema });
  return { db, close: () => sqlite.close() };
}
