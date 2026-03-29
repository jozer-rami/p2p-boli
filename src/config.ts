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

const isDryRun = optional('DRY_RUN', 'false') === 'true';

export const envConfig = {
  dryRun: isDryRun,
  bybit: {
    apiKey: required('BYBIT_API_KEY'),
    apiSecret: required('BYBIT_API_SECRET'),
    testnet: optional('BYBIT_TESTNET', 'true') === 'true',
    userId: optional('BYBIT_USER_ID', '139499611'),
  },
  telegram: {
    botToken: required('TELEGRAM_BOT_TOKEN'),
    chatId: required('TELEGRAM_CHAT_ID'),
  },
  db: {
    path: isDryRun ? './data/bot-dry-run.db' : optional('DB_PATH', './data/bot.db'),
  },
  log: {
    level: optional('LOG_LEVEL', 'info'),
  },
  dashboard: {
    port: parseInt(optional('DASHBOARD_PORT', '3000'), 10),
  },
} as const;

/** Default config values seeded into the DB config table on first run */
export const DEFAULT_CONFIG = {
  min_spread: '0.015',
  max_spread: '0.05',
  trade_amount_usdt: '300',
  poll_interval_orders_ms: '5000',
  poll_interval_ads_ms: '30000',
  poll_interval_prices_ms: '30000',
  auto_cancel_timeout_ms: '900000',
  active_sides: 'sell',
  bot_state: 'running',
  volatility_threshold_percent: '2',
  volatility_window_minutes: '5',
  reprice_enabled: 'false',
  sleep_start_hour: '23',
  sleep_end_hour: '10',
  qr_pre_message: 'Hola! En breve te enviaremos el codigo QR para realizar el pago.',
} as const;

export type ConfigKey = keyof typeof DEFAULT_CONFIG;

log.info('config loaded');
