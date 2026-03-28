import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').default("(datetime('now'))"),
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
  qrCodePath: text('qr_code_path'),
  paymentMessage: text('payment_message'),
  updatedAt: text('updated_at').default("(datetime('now'))"),
});

export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bybitOrderId: text('bybit_order_id').unique().notNull(),
  side: text('side').notNull(),
  amountUsdt: real('amount_usdt').notNull(),
  priceBob: real('price_bob').notNull(),
  totalBob: real('total_bob').notNull(),
  spreadCaptured: real('spread_captured'),
  counterpartyId: text('counterparty_id'),
  counterpartyName: text('counterparty_name'),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').default("(datetime('now'))"),
  completedAt: text('completed_at'),
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
  createdAt: text('created_at').default("(datetime('now'))"),
  updatedAt: text('updated_at').default("(datetime('now'))"),
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
  payload: text('payload'),
  timestamp: text('timestamp').default("(datetime('now'))"),
  module: text('module'),
});
