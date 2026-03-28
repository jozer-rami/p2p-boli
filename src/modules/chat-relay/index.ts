import type { EventBus } from '../../event-bus.js';
import type { BybitClient } from '../../bybit/client.js';
import type { TelegramBot } from '../telegram/index.js';
import type { MonitoredChat } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('chat-relay');

const IMAGE_URL_PATTERN = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;

function isImage(content: string, contentType: string): boolean {
  if (contentType === '2') return true;
  return IMAGE_URL_PATTERN.test(content);
}

export class ChatRelay {
  private readonly bus: EventBus;
  private readonly bybit: BybitClient;
  private readonly telegram: TelegramBot;
  private readonly selfUserId: string;

  private readonly monitoredChats: Map<string, MonitoredChat> = new Map();
  private intervalHandle: ReturnType<typeof setInterval> | undefined;

  constructor(
    bus: EventBus,
    bybit: BybitClient,
    telegram: TelegramBot,
    selfUserId: string,
  ) {
    this.bus = bus;
    this.bybit = bybit;
    this.telegram = telegram;
    this.selfUserId = selfUserId;

    this.setupEventListeners();
  }

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------

  private setupEventListeners(): void {
    this.bus.on('order:new', (payload) => {
      log.info({ orderId: payload.orderId, side: payload.side }, 'Starting chat monitoring');
      this.monitoredChats.set(payload.orderId, {
        orderId: payload.orderId,
        side: payload.side,
        counterpartyName: payload.counterparty,
        lastSeenMessageTime: 0,
      });
    });

    const stopMonitoring = (orderId: string) => {
      if (this.monitoredChats.has(orderId)) {
        log.info({ orderId }, 'Stopping chat monitoring');
        this.monitoredChats.delete(orderId);
      }
    };

    this.bus.on('order:released', (payload) => stopMonitoring(payload.orderId));
    this.bus.on('order:cancelled', (payload) => stopMonitoring(payload.orderId));
    this.bus.on('order:disputed', (payload) => stopMonitoring(payload.orderId));

    this.bus.on('telegram:chat-reply', async (payload) => {
      const { orderId, text, photoPath } = payload;
      try {
        if (photoPath) {
          log.info({ orderId, photoPath }, 'Relaying photo from Telegram to Bybit');
          await this.bybit.sendOrderImage(orderId, photoPath);
          await this.bus.emit('chat:message-sent', { orderId, content: photoPath }, 'ChatRelay');
        } else if (text) {
          log.info({ orderId }, 'Relaying text from Telegram to Bybit');
          await this.bybit.sendOrderMessage(orderId, text);
          await this.bus.emit('chat:message-sent', { orderId, content: text }, 'ChatRelay');
        }
      } catch (err) {
        log.error({ err, orderId }, 'Failed to relay Telegram reply to Bybit');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  async pollOnce(): Promise<void> {
    for (const chat of this.monitoredChats.values()) {
      await this.pollChat(chat);
    }
  }

  private async pollChat(chat: MonitoredChat): Promise<void> {
    try {
      const messages = await this.bybit.getOrderMessages(chat.orderId);

      let latestTime = chat.lastSeenMessageTime;

      for (const msg of messages) {
        // Skip own messages
        if (msg.fromUserId === this.selfUserId) continue;

        // Skip already-seen messages
        if (msg.sendTime <= chat.lastSeenMessageTime) continue;

        if (msg.sendTime > latestTime) {
          latestTime = msg.sendTime;
        }

        try {
          if (isImage(msg.content, msg.contentType)) {
            const msgId = await this.telegram.sendChatPhoto(
              chat.orderId,
              chat.counterpartyName,
              msg.content,
            );
            this.telegram.registerChatMessage(msgId, chat.orderId);
          } else {
            const msgId = await this.telegram.sendChatMessage(
              chat.orderId,
              chat.counterpartyName,
              msg.content,
            );
            this.telegram.registerChatMessage(msgId, chat.orderId);
          }

          await this.bus.emit(
            'chat:message-received',
            {
              orderId: chat.orderId,
              from: msg.fromUserId,
              content: msg.content,
              contentType: msg.contentType,
            },
            'ChatRelay',
          );
        } catch (err) {
          log.error({ err, orderId: chat.orderId }, 'Failed to forward message to Telegram');
        }
      }

      if (latestTime > chat.lastSeenMessageTime) {
        chat.lastSeenMessageTime = latestTime;
      }
    } catch (err) {
      log.error({ err, orderId: chat.orderId }, 'Failed to poll chat messages');
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(intervalMs = 5_000): void {
    if (this.intervalHandle !== undefined) return;
    log.info({ intervalMs }, 'ChatRelay polling started');
    this.intervalHandle = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
      log.info('ChatRelay polling stopped');
    }
  }

  // ---------------------------------------------------------------------------
  // Inspection
  // ---------------------------------------------------------------------------

  getMonitoredCount(): number {
    return this.monitoredChats.size;
  }
}
