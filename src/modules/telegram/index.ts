import { Bot, type InlineKeyboard } from 'grammy';
import type { EventBus } from '../../event-bus.js';
import type { DB } from '../../db/index.js';
import { createModuleLogger } from '../../utils/logger.js';
import { registerCommands, type CommandDeps } from './commands.js';
import { confirmReleaseKeyboard, markAsPaidKeyboard } from './keyboards.js';
import {
  formatOrderNew,
  formatPaymentClaimed,
  formatOrderReleased,
  formatOrderCancelled,
  formatAdPaused,
  formatLowBalance,
  formatEmergency,
  formatBotStarted,
  formatBotStopping,
  type BotStartedData,
  type EmergencyData,
} from './alerts.js';

const log = createModuleLogger('telegram');

export class TelegramBot {
  private readonly bus: EventBus;
  private readonly db: DB;
  private readonly chatId: string;
  private readonly bot: Bot;

  constructor(
    bus: EventBus,
    db: DB,
    botToken: string,
    chatId: string,
    deps: CommandDeps,
  ) {
    this.bus = bus;
    this.db = db;
    this.chatId = chatId;
    this.bot = new Bot(botToken);

    this.setupCommands(deps);
    this.setupCallbackQueries();
    this.setupEventListeners();
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  private setupCommands(deps: CommandDeps): void {
    const handlers = registerCommands(deps);

    this.bot.command('status', handlers.status);
    this.bot.command('balance', handlers.balance);
    this.bot.command('profit', handlers.profit);
    this.bot.command('ads', handlers.ads);
    this.bot.command('orders', handlers.orders);
    this.bot.command('pause', handlers.pause);
    this.bot.command('resume', handlers.resume);
    this.bot.command('setMinSpread', handlers.setMinSpread);
    this.bot.command('setMaxSpread', handlers.setMaxSpread);
    this.bot.command('setAmount', handlers.setAmount);
    this.bot.command('emergency', handlers.emergency);
    this.bot.command('setVolatilityThreshold', handlers.setVolatilityThreshold);
    this.bot.command('setVolatilityWindow', handlers.setVolatilityWindow);
    this.bot.command('release', handlers.release);
    this.bot.command('cancel', handlers.cancel);
  }

  // ---------------------------------------------------------------------------
  // Callback queries (inline keyboard buttons)
  // ---------------------------------------------------------------------------

  private setupCallbackQueries(): void {
    // release:<orderId>
    this.bot.callbackQuery(/^release:(.+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      log.info({ orderId }, 'Release callback received');
      await ctx.answerCallbackQuery({ text: 'Releasing order...' });
      await this.bus.emit('telegram:release', { orderId }, 'TelegramBot');
      await ctx.editMessageText(`Releasing order #${orderId}...`);
    });

    // dispute:<orderId>
    this.bot.callbackQuery(/^dispute:(.+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      log.info({ orderId }, 'Dispute callback received');
      await ctx.answerCallbackQuery({ text: 'Opening dispute...' });
      await this.bus.emit('telegram:dispute', { orderId }, 'TelegramBot');
      await ctx.editMessageText(`Dispute opened for order #${orderId}.`);
    });

    // paid:<orderId>
    this.bot.callbackQuery(/^paid:(.+)$/, async (ctx) => {
      const orderId = ctx.match[1];
      log.info({ orderId }, 'Paid callback received');
      await ctx.answerCallbackQuery({ text: 'Marked as paid' });
      await ctx.editMessageText(`Order #${orderId} marked as paid.`);
    });
  }

  // ---------------------------------------------------------------------------
  // Event listeners → send alert messages
  // ---------------------------------------------------------------------------

  private setupEventListeners(): void {
    this.bus.on('order:new', (payload) => {
      const text = formatOrderNew(payload);
      const keyboard = payload.side === 'sell'
        ? confirmReleaseKeyboard(payload.orderId)
        : markAsPaidKeyboard(payload.orderId);
      void this.send(text, keyboard);
    });

    this.bus.on('order:payment-claimed', (payload) => {
      const text = formatPaymentClaimed(payload);
      const keyboard = confirmReleaseKeyboard(payload.orderId);
      void this.send(text, keyboard);
    });

    this.bus.on('order:released', (payload) => {
      void this.send(formatOrderReleased(payload));
    });

    this.bus.on('order:cancelled', (payload) => {
      void this.send(formatOrderCancelled(payload));
    });

    this.bus.on('ad:paused', (payload) => {
      void this.send(formatAdPaused(payload));
    });

    this.bus.on('bank:low-balance', (payload) => {
      void this.send(formatLowBalance(payload));
    });

    this.bus.on('emergency:triggered', (payload) => {
      // We need pending order count but we don't have direct access here.
      // The EmergencyStop module does not include it in the event payload,
      // so we pass 0 as a fallback (callers can extend the payload if needed).
      const data: EmergencyData = {
        trigger: payload.trigger,
        reason: payload.reason,
        exposure: payload.exposure,
        marketState: payload.marketState,
        pendingOrders: 0,
      };
      void this.send(formatEmergency(data));
    });
  }

  // ---------------------------------------------------------------------------
  // Startup / shutdown messages
  // ---------------------------------------------------------------------------

  async sendStartupMessage(data: BotStartedData): Promise<void> {
    await this.send(formatBotStarted(data));
  }

  async sendShutdownMessage(pendingOrders: number): Promise<void> {
    await this.send(formatBotStopping(pendingOrders));
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    log.info('Starting Telegram bot polling');
    this.bot.start({
      onStart: () => log.info('Telegram bot polling started'),
    });
  }

  async stop(): Promise<void> {
    log.info('Stopping Telegram bot');
    await this.bot.stop();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async send(text: string, keyboard?: InlineKeyboard): Promise<void> {
    try {
      await this.bot.api.sendMessage(this.chatId, text, {
        reply_markup: keyboard,
      });
    } catch (err) {
      log.error({ err }, 'Failed to send Telegram message');
    }
  }
}
