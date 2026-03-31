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
import { ChatRelay } from './modules/chat-relay/index.js';
import { TelegramBot } from './modules/telegram/index.js';
import { createApiServer } from './api/index.js';
import { RepricingEngine } from './modules/repricing-engine/index.js';
import { createRepricingRouter } from './api/routes/repricing.js';
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
const qrPreMessage = await getConfig('qr_pre_message');
const gapGuardEnabled = (await getConfig('gap_guard_enabled')) === 'true';
const gapGuardThresholdPercent = parseFloat(await getConfig('gap_guard_threshold_percent'));
const depthGuardEnabled = (await getConfig('depth_guard_enabled')) === 'true';
const depthGuardMinUsdt = parseFloat(await getConfig('depth_guard_min_usdt'));
const sessionDriftGuardEnabled = (await getConfig('session_drift_guard_enabled')) === 'true';
const sessionDriftThresholdPercent = parseFloat(await getConfig('session_drift_threshold_percent'));

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

const bankManager = new BankManager(db, bus);

const priceMonitor = new PriceMonitor(bus, db, criptoYaClient, {
  volatilityThresholdPercent,
  volatilityWindowMinutes,
  gapGuardEnabled,
  gapGuardThresholdPercent,
  depthGuardEnabled,
  depthGuardMinUsdt,
  sessionDriftGuardEnabled,
  sessionDriftThresholdPercent,
}, bybitClient);

const adManager = new AdManager(
  bus,
  db,
  bybitClient,
  { minSpread, maxSpread, tradeAmountUsdt },
  (side, amount) => bankManager.selectAccount({ side, minBalance: amount }),
);

// Repricing engine
const repricingEngine = new RepricingEngine(
  {
    mode: 'conservative',
    targetPosition: 3,
    antiOscillationThreshold: 0.003,
    minSpread,
    maxSpread,
    filters: {
      minOrderAmount: 100,
      verifiedOnly: true,
      minCompletionRate: 80,
      minOrderCount: 10,
      merchantLevels: ['GA', 'VA'],
    },
    selfUserId: envConfig.bybit.userId,
  },
  async () => {
    const [sell, buy] = await Promise.all([
      bybitClient.getOnlineAdsEnriched('sell', 'USDT', 'BOB'),
      bybitClient.getOnlineAdsEnriched('buy', 'USDT', 'BOB'),
    ]);
    return { sell, buy };
  },
);

adManager.setEngine(repricingEngine);

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

  // Try daily_pnl first
  const row = await db
    .select()
    .from(schema.dailyPnl)
    .where(eq(schema.dailyPnl.date, today))
    .get();

  if (row) {
    return { tradesCount: row.tradesCount, profitBob: row.profitBob, volumeUsdt: row.volumeUsdt };
  }

  // Fallback: compute from trades table
  const { gte } = await import('drizzle-orm');
  const todayTrades = await db
    .select()
    .from(schema.trades)
    .where(gte(schema.trades.createdAt, today))
    .all();

  const completed = todayTrades.filter((t) => t.status === 'completed');
  return {
    tradesCount: completed.length,
    profitBob: completed.reduce((sum, t) => sum + (t.spreadCaptured ?? 0) * t.totalBob, 0),
    volumeUsdt: completed.reduce((sum, t) => sum + t.amountUsdt, 0),
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

    // Manual order check — forces a fresh poll and returns tracked orders
    checkOrders: async () => {
      await orderHandler.poll();
      const tracked = orderHandler.getTrackedOrders();
      const result: Array<{ id: string; side: string; amount: number; price: number; totalBob: number; status: string; counterparty: string }> = [];
      for (const order of tracked.values()) {
        if (order.status === 'released' || order.status === 'cancelled') continue;
        result.push({
          id: order.id,
          side: order.side,
          amount: order.amount,
          price: order.price,
          totalBob: order.totalBob,
          status: order.status,
          counterparty: order.counterpartyName,
        });
      }
      return result;
    },

    // Volatility config
    setVolatilityThreshold: (percent: number) => priceMonitor.setVolatilityThreshold(percent),
    setVolatilityWindow: (minutes: number) => priceMonitor.setVolatilityWindow(minutes),
  },
);

// ---------------------------------------------------------------------------
// Chat relay (bidirectional Bybit ↔ Telegram chat)
// ---------------------------------------------------------------------------

const chatRelay = new ChatRelay(bus, bybitClient, telegramBot, envConfig.bybit.userId);

// ---------------------------------------------------------------------------
// LEGACY: remove once simulation is validated — use buildSellOrderMessages() instead
// Auto-send QR code on new sell orders
// ---------------------------------------------------------------------------

bus.on('order:new', async (payload) => {
  if (payload.side !== 'sell') return;

  // Find the bank account used for sell ads
  const activeAds = adManager.getActiveAds();
  const sellAd = activeAds.get('sell');
  if (!sellAd) return;

  if (!sellAd.bankAccountId) return;
  const account = bankManager.getAccountById(sellAd.bankAccountId);
  if (!account) return;

  // Send pre-QR greeting message
  try {
    await bybitClient.sendOrderMessage(payload.orderId, qrPreMessage);
    log.info({ orderId: payload.orderId }, 'Pre-QR message sent to P2P chat');
  } catch (err) {
    log.error({ err, orderId: payload.orderId }, 'Failed to send pre-QR message');
  }

  // Send QR code image if available
  if (account.qrCodePath) {
    try {
      await bybitClient.sendOrderImage(payload.orderId, account.qrCodePath);
      log.info({ orderId: payload.orderId, bank: account.name }, 'QR code sent to P2P chat');
    } catch (err) {
      log.error({ err, orderId: payload.orderId }, 'Failed to send QR code to P2P chat');
    }
  }

  // Send payment instructions
  const message = account.paymentMessage
    || `Please pay ${(payload.amount * payload.price).toFixed(2)} BOB to ${account.name} (${account.bank}) ****${account.accountHint}`;
  try {
    await bybitClient.sendOrderMessage(payload.orderId, message);
    log.info({ orderId: payload.orderId }, 'Payment instructions sent to P2P chat');
  } catch (err) {
    log.error({ err, orderId: payload.orderId }, 'Failed to send payment instructions');
  }
});

// ---------------------------------------------------------------------------
// Auto balance update + profit tracking on order completion
// ---------------------------------------------------------------------------

bus.on('order:released', async (payload) => {
  const { orderId, side, amount, price, totalBob, bankAccountId } = payload;

  // 1. Update bank BOB balance
  if (bankAccountId > 0) {
    if (side === 'sell') {
      // Sold USDT → received BOB
      bankManager.updateBalanceAfterTrade(bankAccountId, +totalBob);
      log.info({ orderId, bank: bankAccountId, bobDelta: +totalBob }, 'Bank balance updated (+BOB from sell)');
    } else {
      // Bought USDT → paid BOB
      bankManager.updateBalanceAfterTrade(bankAccountId, -totalBob);
      log.info({ orderId, bank: bankAccountId, bobDelta: -totalBob }, 'Bank balance updated (-BOB from buy)');
    }
  }

  // 2. Calculate spread profit
  const currentPrices = adManager.getCurrentPrices();
  let spreadProfit = 0;
  if (currentPrices && currentPrices.spread > 0) {
    // Profit per USDT = the spread between our buy and sell price
    spreadProfit = currentPrices.spread * amount;
    log.info({
      orderId,
      side,
      tradePrice: price,
      buyPrice: currentPrices.buyPrice,
      sellPrice: currentPrices.sellPrice,
      spread: currentPrices.spread,
      profitBob: spreadProfit.toFixed(2),
    }, 'Spread profit calculated');
  }

  // 3. Update trade record with spread captured
  if (spreadProfit > 0) {
    try {
      await db
        .update(schema.trades)
        .set({ spreadCaptured: spreadProfit })
        .where(eq(schema.trades.bybitOrderId, orderId));
    } catch (err) {
      log.error({ err, orderId }, 'Failed to update trade spread');
    }
  }

  // 4. Refresh USDT balance from Bybit
  try {
    const bal = await bybitClient.getBalance('USDT');
    log.info({ available: bal.available, frozen: bal.frozen }, 'USDT balance refreshed');
  } catch (err) {
    log.error({ err }, 'Failed to refresh USDT balance');
  }
});

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

  // 5. Apply active_sides config (pause inactive sides)
  const activeSides = await getConfig('active_sides');
  if (activeSides === 'sell') {
    adManager.setPaused('buy', true);
    log.info('Buy side paused (active_sides=sell)');
  } else if (activeSides === 'buy') {
    adManager.setPaused('sell', true);
    log.info('Sell side paused (active_sides=buy)');
  }

  // 6. Apply reprice config
  const repriceEnabled = await getConfig('reprice_enabled');
  if (repriceEnabled === 'false') {
    adManager.setRepriceEnabled(false);
    log.info('Auto-repricing disabled — manual price control');
  }

  // 7. Apply dry run mode
  if (envConfig.dryRun) {
    bybitClient.setDryRun(true);
    log.info({ dbPath: envConfig.db.path }, 'DRY RUN mode — separate DB, no real trades');
  }

  // 8. Start polling loops
  orderHandler.start(pollIntervalOrdersMs);
  priceMonitor.start(pollIntervalPricesMs);
  adManager.start(pollIntervalAdsMs);
  chatRelay.start(10_000); // 10s chat polling

  // 7. Start dashboard API server
  const apiServer = createApiServer({
    bus,
    db,
    orderHandler,
    adManager,
    priceMonitor,
    bankManager,
    emergencyStop,
    bybitClient: bybitClient,
    getTodayProfit,
    bybitUserId: envConfig.bybit.userId,
    qrPreMessage,
    repricingEngine,
  });
  apiServer.listen(envConfig.dashboard.port, () => {
    log.info({ port: envConfig.dashboard.port }, 'Dashboard API server started');
  });

  // 8. Send startup message with current ad info
  await telegramBot.sendStartupMessage({
    minSpread,
    maxSpread,
    tradeAmountUsdt,
    activeSides: await getConfig('active_sides'),
    testnet: envConfig.bybit.testnet,
  });

  // Send current ad status
  const activeAds = adManager.getActiveAds();
  if (activeAds.size > 0) {
    const lines = ['📊 Current Ads:'];
    for (const [side, ad] of activeAds) {
      lines.push(`  ${side.toUpperCase()}: ${ad.amountUsdt} USDT @ ${ad.price} BOB (ID: ${ad.bybitAdId.slice(-8)})`);
    }
    const balance = await bybitClient.getBalance('USDT');
    lines.push(`\n💰 USDT Balance: ${balance.available} available, ${balance.frozen} frozen`);
    lines.push(`🏦 Bank accounts: ${bankManager.getAccounts().filter(a => a.status === 'active').length} active`);
    const totalBob = bankManager.getTotalBobBalance();
    lines.push(`💵 BOB Balance: ${totalBob.toFixed(0)} (estimated)`);
    if (envConfig.dryRun) lines.push(`\n🧪 DRY RUN MODE — no real trades`);
    const sleepStart = await getConfig('sleep_start_hour');
    const sleepEnd = await getConfig('sleep_end_hour');
    lines.push(`😴 Sleep: ${sleepStart}:00 - ${sleepEnd}:00 BOT`);
    await telegramBot.sendRaw(lines.join('\n'));
  } else {
    const mode = envConfig.dryRun ? ' (DRY RUN)' : '';
    await telegramBot.sendRaw(`📊 No active ads${mode}. Bot will create one on next tick.`);
  }

  // 9. Schedule daily reset at midnight
  scheduleDailyReset();

  // 10. Schedule sleep mode
  scheduleSleepMode();

  log.info('boli-p2p-bot started successfully');
}

function scheduleDailyReset(): void {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(async () => {
    log.info('Running daily reset...');
    await bankManager.resetDailyVolumes();
    log.info('Daily volumes reset');
    scheduleDailyReset();
  }, msUntilMidnight);

  log.info({ msUntilMidnight }, 'Daily reset scheduled');
}

// ---------------------------------------------------------------------------
// Sleep mode (BOT = UTC-4)
// ---------------------------------------------------------------------------

const BOT_UTC_OFFSET = -4; // Bolivia Time

function getNowBOT(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  return new Date(utc + BOT_UTC_OFFSET * 3600_000);
}

function isInSleepWindow(sleepStart: number, sleepEnd: number): boolean {
  const hour = getNowBOT().getHours();
  if (sleepStart > sleepEnd) {
    // Wraps midnight: e.g., 23-10 means 23,0,1,...,9 are sleep
    return hour >= sleepStart || hour < sleepEnd;
  }
  return hour >= sleepStart && hour < sleepEnd;
}

let isSleeping = false;

async function checkSleepMode(): Promise<void> {
  const sleepStart = parseInt(await getConfig('sleep_start_hour'));
  const sleepEnd = parseInt(await getConfig('sleep_end_hour'));
  const shouldSleep = isInSleepWindow(sleepStart, sleepEnd);
  const botHour = getNowBOT().getHours();

  if (shouldSleep && !isSleeping) {
    isSleeping = true;
    log.info({ botHour, sleepStart, sleepEnd }, 'Entering sleep mode');
    adManager.setPaused('buy', true);
    adManager.setPaused('sell', true);
    await adManager.removeAllAds();
    await telegramBot.sendRaw(`😴 Sleep mode active (${sleepStart}:00 - ${sleepEnd}:00 BOT). Ads removed.`);
  } else if (!shouldSleep && isSleeping) {
    isSleeping = false;
    log.info({ botHour, sleepStart, sleepEnd }, 'Waking up from sleep mode');
    const activeSides = await getConfig('active_sides');
    if (activeSides === 'both' || activeSides === 'sell') adManager.setPaused('sell', false);
    if (activeSides === 'both' || activeSides === 'buy') adManager.setPaused('buy', false);
    await telegramBot.sendRaw(`☀️ Woke up! Trading resumed (${activeSides} mode).`);
  }
}

function scheduleSleepMode(): void {
  // Check every 5 minutes
  setInterval(() => void checkSleepMode(), 5 * 60_000);
  // Also check immediately
  void checkSleepMode();
  log.info('Sleep mode scheduler started (checks every 5 min)');
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Shutdown signal received');

  // 1. Stop polling
  stopPolling();
  chatRelay.stop();

  // 2. Keep ads live on shutdown (single-ad account — don't waste the slot)
  // Ads will be synced and repriced on next startup
  log.info('Ads kept live for continuity (will sync on restart)');

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
