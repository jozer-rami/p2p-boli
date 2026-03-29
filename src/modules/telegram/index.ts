import { Bot, InputFile, type InlineKeyboard } from 'grammy';
import { mkdir } from 'fs/promises';
import { writeFileSync } from 'fs';
import { join } from 'path';
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
  private readonly chatReplyMap: Map<number, string> = new Map();

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
    this.bot.command('check', handlers.check);
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

    // Reply-to-message detection for chat relay
    this.bot.on('message', async (ctx) => {
      const reply = ctx.message.reply_to_message;
      if (!reply) return;

      const orderId = this.chatReplyMap.get(reply.message_id);
      if (!orderId) return;

      if (ctx.message.text) {
        await this.bus.emit('telegram:chat-reply', { orderId, text: ctx.message.text }, 'TelegramBot');
        return;
      }

      if (ctx.message.photo && ctx.message.photo.length > 0) {
        try {
          const photo = ctx.message.photo[ctx.message.photo.length - 1];
          const file = await ctx.api.getFile(photo.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
          await mkdir('./data/tmp', { recursive: true });
          const tempPath = join('./data/tmp', `${file.file_unique_id}.jpg`);
          const res = await fetch(fileUrl);
          const buf = Buffer.from(await res.arrayBuffer());
          writeFileSync(tempPath, buf);
          await this.bus.emit('telegram:chat-reply', { orderId, photoPath: tempPath }, 'TelegramBot');
        } catch (err) {
          log.error({ err, orderId }, 'Failed to process photo reply');
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Event listeners → send alert messages
  // ---------------------------------------------------------------------------

  private setupEventListeners(): void {
    this.bus.on('ad:created', (payload) => {
      void this.send(`📢 Ad created (${payload.side.toUpperCase()}): ${payload.price} BOB/USDT — ${payload.bankAccount}`);
    });

    this.bus.on('ad:repriced', (payload) => {
      void this.send(`🔄 Ad repriced (${payload.side.toUpperCase()}): ${payload.oldPrice} → ${payload.newPrice} BOB/USDT`);
    });

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

  registerChatMessage(telegramMsgId: number, orderId: string): void {
    this.chatReplyMap.set(telegramMsgId, orderId);
  }

  async sendChatMessage(orderId: string, counterparty: string, text: string): Promise<number> {
    try {
      const msg = await this.bot.api.sendMessage(
        this.chatId,
        `💬 Order #${orderId} (${counterparty}):\n${text}`,
      );
      return msg.message_id;
    } catch (err) {
      log.error({ err, orderId }, 'Failed to send chat message to Telegram');
      return 0;
    }
  }

  async sendChatPhoto(orderId: string, counterparty: string, photoUrl: string): Promise<number> {
    try {
      const response = await fetch(photoUrl);
      if (!response.ok) {
        log.error({ orderId, photoUrl, status: response.status }, 'Failed to download chat photo');
        return this.sendChatMessage(orderId, counterparty, `[Image] ${photoUrl}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const inputFile = new InputFile(buffer, 'chat-image.jpg');
      const msg = await this.bot.api.sendPhoto(this.chatId, inputFile, {
        caption: `📷 Order #${orderId} (${counterparty})`,
      });
      return msg.message_id;
    } catch (err) {
      log.error({ err, orderId }, 'Failed to send chat photo to Telegram');
      return this.sendChatMessage(orderId, counterparty, `[Image] ${photoUrl}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async send(text: string, keyboard?: InlineKeyboard): Promise<void> {
    try {
      await this.bot.api.sendMessage(this.chatId, text, {
        reply_markup: keyboard,
      });
      log.debug({ text: text.substring(0, 50) }, 'Telegram message sent');
    } catch (err) {
      log.error({ err, text: text.substring(0, 50) }, 'Failed to send Telegram message');
    }
  }
}
