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
import { eq } from 'drizzle-orm';

const log = createModuleLogger('main');

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

const db = createDB(envConfig.db.path);
const bus = new EventBus(db);

// ---------------------------------------------------------------------------
// Seed default config values (only inserts if the key doesn't exist)
// ---------------------------------------------------------------------------

for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
  const existing = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.key, key))
    .get();

  if (!existing) {
    await db.insert(schema.config).values({ key, value });
    log.debug({ key, value }, 'Seeded default config value');
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

async function getConfig(key: ConfigKey): Promise<string> {
  const row = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.key, key))
    .get();

  return row?.value ?? DEFAULT_CONFIG[key];
}

async function setConfig(key: ConfigKey, value: string): Promise<void> {
  await db
    .insert(schema.config)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: schema.config.key,
      set: { value, updatedAt: new Date().toISOString() },
    });
}

// ---------------------------------------------------------------------------
// External clients
// ---------------------------------------------------------------------------

const bybitClient = new BybitClient(
  envConfig.bybit.apiKey,
  envConfig.bybit.apiSecret,
  envConfig.bybit.testnet,
);

const criptoYaClient = new CriptoYaClient();

// ---------------------------------------------------------------------------
// Read initial config values from DB
// ---------------------------------------------------------------------------

const volatilityThresholdPercent = parseFloat(await getConfig('volatility_threshold_percent'));
const volatilityWindowMinutes = parseFloat(await getConfig('volatility_window_minutes'));
const minSpread = parseFloat(await getConfig('min_spread'));
const maxSpread = parseFloat(await getConfig('max_spread'));
const tradeAmountUsdt = parseFloat(await getConfig('trade_amount_usdt'));
const autoCancelTimeoutMs = parseInt(await getConfig('auto_cancel_timeout_ms'), 10);
const pollIntervalOrdersMs = parseInt(await getConfig('poll_interval_orders_ms'), 10);
const pollIntervalAdsMs = parseInt(await getConfig('poll_interval_ads_ms'), 10);
const pollIntervalPricesMs = parseInt(await getConfig('poll_interval_prices_ms'), 10);

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

const bankManager = new BankManager(db, bus);

const priceMonitor = new PriceMonitor(bus, db, criptoYaClient, {
  volatilityThresholdPercent,
  volatilityWindowMinutes,
});

const adManager = new AdManager(
  bus,
  db,
  bybitClient,
  { minSpread, maxSpread, tradeAmountUsdt },
  (side, amount) => bankManager.selectAccount({ side, minBalance: amount }),
);

const orderHandler = new OrderHandler(bus, db, bybitClient, autoCancelTimeoutMs);

// ---------------------------------------------------------------------------
// Helper functions for EmergencyStop and CommandDeps
// ---------------------------------------------------------------------------

function getMarketState(): { ask: number; bid: number } {
  const bybitPrices = priceMonitor.getBybitPrices();
  const latest = priceMonitor.getLatestPrices();
  const prices = bybitPrices ?? latest[0];
  return {
    ask: prices?.ask ?? 0,
    bid: prices?.bid ?? 0,
  };
}

async function getExposure(): Promise<{ usdt: number; bob: number }> {
  // USDT exposure = sum of active buy-side ad amounts
  // BOB exposure = total BOB balance across bank accounts
  const activeAds = adManager.getActiveAds();
  let usdtExposure = 0;
  for (const ad of activeAds.values()) {
    if (ad.side === 'buy') {
      usdtExposure += ad.amountUsdt;
    }
  }
  const bobExposure = bankManager.getTotalBobBalance();
  return { usdt: usdtExposure, bob: bobExposure };
}

function stopPolling(): void {
  orderHandler.stop();
  priceMonitor.stop();
  adManager.stop();
}

function startPolling(): void {
  orderHandler.start(pollIntervalOrdersMs);
  priceMonitor.start(pollIntervalPricesMs);
  adManager.start(pollIntervalAdsMs);
}

const emergencyStop = new EmergencyStop(bus, db, {
  removeAllAds: () => adManager.removeAllAds(),
  getExposure,
  getMarketState,
  getPendingOrderCount: () => orderHandler.getPendingCount(),
  stopPolling,
  startPolling,
});

// ---------------------------------------------------------------------------
// getTodayProfit helper
// ---------------------------------------------------------------------------

async function getTodayProfit(): Promise<{ tradesCount: number; profitBob: number; volumeUsdt: number }> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const row = await db
    .select()
    .from(schema.dailyPnl)
    .where(eq(schema.dailyPnl.date, today))
    .get();

  if (!row) {
    return { tradesCount: 0, profitBob: 0, volumeUsdt: 0 };
  }

  return {
    tradesCount: row.tradesCount,
    profitBob: row.profitBob,
    volumeUsdt: row.volumeUsdt,
  };
}

// ---------------------------------------------------------------------------
// TelegramBot with CommandDeps
// ---------------------------------------------------------------------------

const telegramBot = new TelegramBot(
  bus,
  db,
  envConfig.telegram.botToken,
  envConfig.telegram.chatId,
  {
    // Status / info
    getBotState: () => emergencyStop.getState(),
    getPendingOrderCount: () => orderHandler.getPendingCount(),
    getActiveAds: () => {
      const ads = adManager.getActiveAds();
      return Array.from(ads.values()).map((ad) => ({
        side: ad.side,
        price: ad.price,
        amountUsdt: ad.amountUsdt,
      }));
    },

    // Bank / balance
    getBankAccounts: () =>
      bankManager.getAccounts().map((a) => ({
        id: a.id,
        name: a.name,
        balanceBob: a.balanceBob,
        status: a.status,
      })),
    setBalance: async (accountName: string, balance: number) => {
      const account = bankManager.getAccounts().find(
        (a) => a.name.toLowerCase() === accountName.toLowerCase(),
      );
      if (!account) {
        throw new Error(`Bank account not found: ${accountName}`);
      }
      await bankManager.setBalance(account.id, balance);
    },
    getTotalBobBalance: () => bankManager.getTotalBobBalance(),

    // Profit
    getTodayProfit,

    // Ad control
    setPaused: (side, paused) => {
      adManager.setPaused(side, paused);
    },
    updatePricingConfig: (patch) => {
      const currentAds = adManager.getActiveAds();
      const firstAd = Array.from(currentAds.values())[0];
      const current = {
        minSpread,
        maxSpread,
        tradeAmountUsdt: firstAd?.amountUsdt ?? tradeAmountUsdt,
      };
      adManager.updateConfig({
        minSpread: patch.minSpread ?? current.minSpread,
        maxSpread: patch.maxSpread ?? current.maxSpread,
        tradeAmountUsdt: patch.tradeAmountUsdt ?? current.tradeAmountUsdt,
      });
    },

    // Emergency
    triggerEmergency: (reason: string) => emergencyStop.trigger('manual', reason),
    resolveEmergency: (resumedBy: string) => emergencyStop.resolve(resumedBy),
    getExposure,
    getMarketState,

    // Order actions
    releaseOrder: (orderId: string) => orderHandler.releaseOrder(orderId),
    cancelOrder: async (orderId: string) => {
      await bus.emit('order:cancelled', { orderId, reason: 'manual cancel via Telegram' }, 'main');
    },

    // Volatility config
    setVolatilityThreshold: (percent: number) => priceMonitor.setVolatilityThreshold(percent),
    setVolatilityWindow: (minutes: number) => priceMonitor.setVolatilityWindow(minutes),
  },
);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

const startTime = Date.now();

async function start(): Promise<void> {
  log.info('Starting boli-p2p-bot...');

  // 1. Load bank accounts
  await bankManager.loadAccounts();
  log.info({ count: bankManager.getAccounts().length }, 'Bank accounts loaded');

  // 2. Fetch initial prices
  await priceMonitor.fetchOnce();
  log.info('Initial prices fetched');

  // 3. Sync existing ads and pending orders from Bybit
  await adManager.syncExistingAds();
  log.info('Existing ads synced');

  await orderHandler.syncPendingOrders();
  log.info('Pending orders synced');

  // 4. Start Telegram bot
  telegramBot.start();

  // 5. Start polling loops
  orderHandler.start(pollIntervalOrdersMs);
  priceMonitor.start(pollIntervalPricesMs);
  adManager.start(pollIntervalAdsMs);

  // 6. Send startup message
  await telegramBot.sendStartupMessage({
    minSpread,
    maxSpread,
    tradeAmountUsdt,
    activeSides: await getConfig('active_sides'),
    testnet: envConfig.bybit.testnet,
  });

  // 7. Schedule daily reset at midnight
  scheduleDailyReset();

  log.info('boli-p2p-bot started successfully');
}

function scheduleDailyReset(): void {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // Next midnight
  const msUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(async () => {
    log.info('Running daily reset...');
    await bankManager.resetDailyVolumes();
    log.info('Daily volumes reset');
    // Reschedule for next day
    scheduleDailyReset();
  }, msUntilMidnight);

  log.info({ msUntilMidnight }, 'Daily reset scheduled');
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Shutdown signal received');

  // 1. Stop polling
  stopPolling();

  // 2. Remove all ads
  try {
    await adManager.removeAllAds();
    log.info('All ads removed');
  } catch (err) {
    log.error({ err }, 'Failed to remove all ads during shutdown');
  }

  // 3. Send shutdown message
  try {
    await telegramBot.sendShutdownMessage(orderHandler.getPendingCount());
  } catch (err) {
    log.error({ err }, 'Failed to send shutdown message');
  }

  // 4. Stop Telegram bot
  try {
    await telegramBot.stop();
  } catch (err) {
    log.error({ err }, 'Failed to stop Telegram bot');
  }

  log.info('Shutdown complete');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Signal handlers
// ---------------------------------------------------------------------------

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled promise rejection');
});

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

void start();
