import type { Context } from 'grammy';
import type { Side } from '../../event-bus.js';
import type { BotState } from '../emergency-stop/types.js';
import { createModuleLogger } from '../../utils/logger.js';
import { confirmReleaseKeyboard } from './keyboards.js';

const log = createModuleLogger('telegram-commands');

// ---------------------------------------------------------------------------
// Dependencies injected from the outside world
// ---------------------------------------------------------------------------

export interface CommandDeps {
  // Status / info
  getBotState: () => BotState;
  getPendingOrderCount: () => number;
  getActiveAds: () => Array<{ side: Side; price: number; amountUsdt: number }>;

  // Bank / balance
  getBankAccounts: () => Array<{ id: number; name: string; balanceBob: number; status: string }>;
  setBalance: (accountName: string, balance: number) => Promise<void>;
  getTotalBobBalance: () => number;

  // Profit / trades
  getTodayProfit: () => Promise<{ tradesCount: number; profitBob: number; volumeUsdt: number }>;

  // Ad control
  setPaused: (side: Side, paused: boolean) => void;
  updatePricingConfig: (patch: { minSpread?: number; maxSpread?: number; tradeAmountUsdt?: number; imbalanceThresholdUsdt?: number }) => void;

  // Emergency
  triggerEmergency: (reason: string) => Promise<void>;
  resolveEmergency: (resumedBy: string) => Promise<void>;
  getExposure: () => Promise<{ usdt: number; bob: number }>;
  getMarketState: () => { ask: number; bid: number };

  // Order actions
  releaseOrder: (orderId: string) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;

  // Manual order check — forces a fresh poll and returns tracked orders
  checkOrders: () => Promise<Array<{ id: string; side: string; amount: number; price: number; totalBob: number; status: string; counterparty: string }>>;

  // Volatility config
  setVolatilityThreshold: (percent: number) => void;
  setVolatilityWindow: (minutes: number) => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerCommands(deps: CommandDeps): Record<string, (ctx: Context) => Promise<void>> {
  async function status(ctx: Context): Promise<void> {
    try {
      const state = deps.getBotState();
      const pending = deps.getPendingOrderCount();
      const ads = deps.getActiveAds();
      const totalBob = deps.getTotalBobBalance();

      const adLines = ads.length === 0
        ? '  (none)'
        : ads.map((a) => `  ${a.side.toUpperCase()}: ${a.price} BOB @ ${a.amountUsdt} USDT`).join('\n');

      const text = [
        `Bot Status: ${state.toUpperCase()}`,
        `Pending Orders: ${pending}`,
        `Total BOB Balance: ${totalBob.toFixed(2)}`,
        `Active Ads:`,
        adLines,
      ].join('\n');

      await ctx.reply(text);
    } catch (err) {
      log.error({ err }, '/status failed');
      await ctx.reply('Failed to get status.');
    }
  }

  async function balance(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? '';
      // Format: /balance [accountName] [amount]
      const parts = text.trim().split(/\s+/);

      if (parts.length === 3) {
        // Set mode: /balance banco-union 15000
        const accountName = parts[1];
        const amount = parseFloat(parts[2]);

        if (isNaN(amount) || amount < 0) {
          await ctx.reply('Invalid amount. Usage: /balance <account-name> <amount>');
          return;
        }

        await deps.setBalance(accountName, amount);
        await ctx.reply(`Balance updated: ${accountName} → ${amount} BOB`);
        return;
      }

      // Read mode: show all accounts
      const accounts = deps.getBankAccounts();
      if (accounts.length === 0) {
        await ctx.reply('No bank accounts configured.');
        return;
      }

      const lines = accounts.map(
        (a) => `${a.name} (${a.status}): ${a.balanceBob.toFixed(2)} BOB`,
      );
      await ctx.reply(['Bank Balances:', ...lines].join('\n'));
    } catch (err) {
      log.error({ err }, '/balance failed');
      await ctx.reply('Failed to get/set balance.');
    }
  }

  async function profit(ctx: Context): Promise<void> {
    try {
      const pnl = await deps.getTodayProfit();
      const text = [
        `Today's Profit`,
        `Trades: ${pnl.tradesCount}`,
        `Volume: ${pnl.volumeUsdt.toFixed(2)} USDT`,
        `Profit: ${pnl.profitBob.toFixed(2)} BOB`,
      ].join('\n');
      await ctx.reply(text);
    } catch (err) {
      log.error({ err }, '/profit failed');
      await ctx.reply('Failed to get profit data.');
    }
  }

  async function ads(ctx: Context): Promise<void> {
    try {
      const activeAds = deps.getActiveAds();
      if (activeAds.length === 0) {
        await ctx.reply('No active ads.');
        return;
      }
      const lines = activeAds.map(
        (a) => `${a.side.toUpperCase()}: ${a.price} BOB @ ${a.amountUsdt} USDT`,
      );
      await ctx.reply(['Active Ads:', ...lines].join('\n'));
    } catch (err) {
      log.error({ err }, '/ads failed');
      await ctx.reply('Failed to get ads.');
    }
  }

  async function orders(ctx: Context): Promise<void> {
    try {
      const count = deps.getPendingOrderCount();
      await ctx.reply(`Pending Orders: ${count}`);
    } catch (err) {
      log.error({ err }, '/orders failed');
      await ctx.reply('Failed to get orders.');
    }
  }

  async function pause(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? '';
      const parts = text.trim().split(/\s+/);
      // /pause [buy|sell|both]
      const target = (parts[1] ?? 'both').toLowerCase() as Side | 'both';

      if (target === 'both' || target === 'buy') {
        deps.setPaused('buy', true);
      }
      if (target === 'both' || target === 'sell') {
        deps.setPaused('sell', true);
      }

      await ctx.reply(`Paused: ${target}`);
    } catch (err) {
      log.error({ err }, '/pause failed');
      await ctx.reply('Failed to pause.');
    }
  }

  async function resume(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? '';
      const parts = text.trim().split(/\s+/);
      const target = (parts[1] ?? 'both').toLowerCase() as Side | 'both';

      if (target === 'both' || target === 'buy') {
        deps.setPaused('buy', false);
      }
      if (target === 'both' || target === 'sell') {
        deps.setPaused('sell', false);
      }

      await ctx.reply(`Resumed: ${target}`);
    } catch (err) {
      log.error({ err }, '/resume failed');
      await ctx.reply('Failed to resume.');
    }
  }

  async function setMinSpread(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? '';
      const parts = text.trim().split(/\s+/);
      const value = parseFloat(parts[1] ?? '');

      if (isNaN(value) || value <= 0 || value >= 1) {
        await ctx.reply('Usage: /setMinSpread <decimal, e.g. 0.015>');
        return;
      }

      deps.updatePricingConfig({ minSpread: value });
      await ctx.reply(`Min spread set to ${(value * 100).toFixed(2)}%`);
    } catch (err) {
      log.error({ err }, '/setMinSpread failed');
      await ctx.reply('Failed to set min spread.');
    }
  }

  async function setMaxSpread(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? '';
      const parts = text.trim().split(/\s+/);
      const value = parseFloat(parts[1] ?? '');

      if (isNaN(value) || value <= 0 || value >= 1) {
        await ctx.reply('Usage: /setMaxSpread <decimal, e.g. 0.05>');
        return;
      }

      deps.updatePricingConfig({ maxSpread: value });
      await ctx.reply(`Max spread set to ${(value * 100).toFixed(2)}%`);
    } catch (err) {
      log.error({ err }, '/setMaxSpread failed');
      await ctx.reply('Failed to set max spread.');
    }
  }

  async function setAmount(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? '';
      const parts = text.trim().split(/\s+/);
      const value = parseFloat(parts[1] ?? '');

      if (isNaN(value) || value <= 0) {
        await ctx.reply('Usage: /setAmount <usdt, e.g. 500>');
        return;
      }

      deps.updatePricingConfig({ tradeAmountUsdt: value });
      await ctx.reply(`Trade amount set to ${value} USDT`);
    } catch (err) {
      log.error({ err }, '/setAmount failed');
      await ctx.reply('Failed to set trade amount.');
    }
  }

  async function emergency(ctx: Context): Promise<void> {
    try {
      await deps.triggerEmergency('Manual emergency triggered via Telegram');
      await ctx.reply('Emergency stop triggered. All ads removed.');
    } catch (err) {
      log.error({ err }, '/emergency failed');
      await ctx.reply('Failed to trigger emergency stop.');
    }
  }

  async function setVolatilityThreshold(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? '';
      const parts = text.trim().split(/\s+/);
      const value = parseFloat(parts[1] ?? '');

      if (isNaN(value) || value <= 0) {
        await ctx.reply('Usage: /setVolatilityThreshold <percent, e.g. 2>');
        return;
      }

      deps.setVolatilityThreshold(value);
      await ctx.reply(`Volatility threshold set to ${value}%`);
    } catch (err) {
      log.error({ err }, '/setVolatilityThreshold failed');
      await ctx.reply('Failed to set volatility threshold.');
    }
  }

  async function setVolatilityWindow(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? '';
      const parts = text.trim().split(/\s+/);
      const value = parseInt(parts[1] ?? '', 10);

      if (isNaN(value) || value <= 0) {
        await ctx.reply('Usage: /setVolatilityWindow <minutes, e.g. 5>');
        return;
      }

      deps.setVolatilityWindow(value);
      await ctx.reply(`Volatility window set to ${value} minutes`);
    } catch (err) {
      log.error({ err }, '/setVolatilityWindow failed');
      await ctx.reply('Failed to set volatility window.');
    }
  }

  async function release(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? '';
      const parts = text.trim().split(/\s+/);
      const orderId = parts[1];

      if (!orderId) {
        await ctx.reply('Usage: /release <orderId>');
        return;
      }

      await deps.releaseOrder(orderId);
      await ctx.reply(`Order ${orderId} released.`);
    } catch (err) {
      log.error({ err }, '/release failed');
      await ctx.reply('Failed to release order.');
    }
  }

  async function cancel(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? '';
      const parts = text.trim().split(/\s+/);
      const orderId = parts[1];

      if (!orderId) {
        await ctx.reply('Usage: /cancel <orderId>');
        return;
      }

      await deps.cancelOrder(orderId);
      await ctx.reply(`Order ${orderId} cancelled.`);
    } catch (err) {
      log.error({ err }, '/cancel failed');
      await ctx.reply('Failed to cancel order.');
    }
  }

  async function check(ctx: Context): Promise<void> {
    try {
      await ctx.reply('Fetching orders from Bybit API...');
      const orders = await deps.checkOrders();

      if (orders.length === 0) {
        await ctx.reply('No pending orders found on Bybit.');
        return;
      }

      for (const o of orders) {
        const statusEmoji =
          o.status === 'payment_marked' ? '💰' :
          o.status === 'awaiting_payment' ? '⏳' :
          o.status === 'disputed' ? '⚠️' : '📋';

        const lines = [
          `${statusEmoji} Order #${o.id}`,
          `Side: ${o.side.toUpperCase()}`,
          `Amount: ${o.amount} USDT @ ${o.price} BOB`,
          `Total: ${o.totalBob.toFixed(2)} BOB`,
          `Status: ${o.status.toUpperCase()}`,
          `Counterparty: ${o.counterparty}`,
        ];

        if (o.status === 'payment_marked') {
          lines.push('', '👆 Buyer claims payment sent. Check your bank and release.');
          await ctx.reply(lines.join('\n'), {
            reply_markup: confirmReleaseKeyboard(o.id),
          });
        } else {
          await ctx.reply(lines.join('\n'));
        }
      }
    } catch (err) {
      log.error({ err }, '/check failed');
      await ctx.reply('Failed to check orders from Bybit API.');
    }
  }

  return {
    status,
    balance,
    profit,
    ads,
    orders,
    pause,
    resume,
    setMinSpread,
    setMaxSpread,
    setAmount,
    emergency,
    setVolatilityThreshold,
    setVolatilityWindow,
    release,
    cancel,
    check,
  };
}
