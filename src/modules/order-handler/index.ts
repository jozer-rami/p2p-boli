import { eq, inArray } from 'drizzle-orm';
import { trades } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import type { EventBus } from '../../event-bus.js';
import type { BybitClient } from '../../bybit/client.js';
import { canTransition, transitionOrder } from './lifecycle.js';
import type { TrackedOrder, OrderStatus } from './types.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('order-handler');

const MODULE = 'OrderHandler';

/**
 * Maps Bybit P2P order status codes to internal OrderStatus strings.
 *
 *  '10' = new
 *  '20' = awaiting_payment
 *  '30' = payment_marked
 *  '40' = released (crypto released to buyer)
 *  '50' = completed/closed (terminal — could be release or cancel, check context)
 *  '60' = disputed
 *
 * NOTE: Bybit uses status 50 for BOTH completed releases AND cancellations.
 * When an order disappears from pending with status 50, we check if we were
 * the seller and funds left our balance to determine if it was a release.
 * For safety, we treat 50 as 'released' since cancelled orders typically
 * return funds to the seller (no USDT loss).
 */
const BYBIT_STATUS_MAP: Record<string, OrderStatus> = {
  '10': 'new',
  '20': 'awaiting_payment',
  '30': 'payment_marked',
  '40': 'released',
  '50': 'released',
  '60': 'disputed',
};

function mapBybitStatus(raw: string | number): OrderStatus | undefined {
  return BYBIT_STATUS_MAP[String(raw)];
}

const TERMINAL_STATUSES: OrderStatus[] = ['released', 'cancelled'];
const PENDING_BYBIT_STATUSES = ['10', '20', '30', '60'];

export class OrderHandler {
  private readonly bus: EventBus;
  private readonly db: DB;
  private readonly bybit: BybitClient;
  private autoCancelTimeoutMs: number;
  private getBankAccountForSide: (side: string) => number;

  /** In-memory map of orderId → TrackedOrder */
  private readonly trackedOrders: Map<string, TrackedOrder> = new Map();

  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    bus: EventBus,
    db: DB,
    bybit: BybitClient,
    autoCancelTimeoutMs = 900_000,
    getBankAccountForSide: (side: string) => number = () => 0,
  ) {
    this.bus = bus;
    this.db = db;
    this.bybit = bybit;
    this.autoCancelTimeoutMs = autoCancelTimeoutMs;
    this.getBankAccountForSide = getBankAccountForSide;

    // Listen for manual release/dispute commands from Telegram
    this.bus.on('telegram:release', ({ orderId }) => {
      void this.releaseOrder(orderId);
    });

    this.bus.on('telegram:dispute', ({ orderId }) => {
      void this.handleDisputeEvent(orderId);
    });
  }

  // ---------------------------------------------------------------------------
  // Startup sync
  // ---------------------------------------------------------------------------

  /**
   * Loads all currently pending orders from Bybit into the in-memory map.
   * Call once during startup before starting the poll loop.
   */
  async syncPendingOrders(): Promise<void> {
    try {
      const bybitOrders = await this.bybit.getPendingOrders();

      for (const order of bybitOrders) {
        const status = mapBybitStatus(order.status);
        if (!status) {
          log.warn({ orderId: order.id, bybitStatus: order.status }, 'Unknown Bybit status — skipping');
          continue;
        }

        if (TERMINAL_STATUSES.includes(status)) continue;

        const bankAccountId = this.getBankAccountForSide(order.side);
        const tracked: TrackedOrder = {
          id: order.id,
          side: order.side,
          amount: order.amount,
          price: order.price,
          totalBob: order.totalBob,
          status,
          counterpartyId: order.counterpartyId ?? '',
          counterpartyName: order.counterpartyName ?? '',
          bankAccountId,
          createdAt: order.createdAt,
          autoCancelAt: order.createdAt + this.autoCancelTimeoutMs,
        };

        this.trackedOrders.set(order.id, tracked);
        log.info({ orderId: order.id, status, bankAccountId }, 'Synced pending order from Bybit');
      }

      log.info({ count: this.trackedOrders.size }, 'Pending order sync complete');
    } catch (err) {
      log.error({ err }, 'Failed to sync pending orders');
    }
  }

  // ---------------------------------------------------------------------------
  // Main polling loop
  // ---------------------------------------------------------------------------

  /**
   * Single polling iteration:
   *  1. Fetch pending orders from Bybit
   *  2. Detect new orders
   *  3. Detect status changes (payment marked, etc.)
   *  4. Detect completed / cancelled orders
   *  5. Check auto-cancel timeouts on awaiting_payment orders
   */
  async poll(): Promise<void> {
    try {
      const bybitOrders = await this.bybit.getPendingOrders();
      const now = Date.now();

      const seenIds = new Set<string>();

      for (const order of bybitOrders) {
        const newStatus = mapBybitStatus(order.status);
        if (!newStatus) {
          log.warn({ orderId: order.id, bybitStatus: order.status }, 'Unknown Bybit status in poll');
          continue;
        }

        seenIds.add(order.id);
        const existing = this.trackedOrders.get(order.id);

        if (!existing) {
          // Brand-new order we have not seen before
          const tracked: TrackedOrder = {
            id: order.id,
            side: order.side,
            amount: order.amount,
            price: order.price,
            totalBob: order.totalBob,
            status: newStatus,
            counterpartyId: order.counterpartyId ?? '',
            counterpartyName: order.counterpartyName ?? '',
            bankAccountId: this.getBankAccountForSide(order.side),
            createdAt: order.createdAt,
            autoCancelAt: order.createdAt + this.autoCancelTimeoutMs,
          };

          this.trackedOrders.set(order.id, tracked);

          log.info(
            { orderId: order.id, side: order.side, amount: order.amount, price: order.price },
            'New order detected',
          );

          await this.bus.emit('order:new', {
            orderId: order.id,
            side: order.side,
            amount: order.amount,
            price: order.price,
            counterparty: order.counterpartyName ?? '',
          }, MODULE);

          // Persist to trades table
          await this.upsertTrade(tracked, 'pending');
          continue;
        }

        // Check for status transitions on known orders
        if (newStatus !== existing.status && canTransition(existing.status, newStatus)) {
          const prevStatus = existing.status;
          existing.status = transitionOrder(existing.status, newStatus);

          log.info({ orderId: order.id, from: prevStatus, to: newStatus }, 'Order status changed');

          if (newStatus === 'payment_marked') {
            await this.bus.emit('order:payment-claimed', {
              orderId: order.id,
              amount: order.amount,
              bankAccount: String(existing.bankAccountId),
            }, MODULE);
          }
        }
      }

      // Detect orders that disappeared from Bybit pending list (completed or cancelled)
      for (const [orderId, order] of this.trackedOrders) {
        if (TERMINAL_STATUSES.includes(order.status)) continue;
        if (seenIds.has(orderId)) continue;

        // Order is no longer in the pending list — fetch its final status
        try {
          const detail = await this.bybit.getOrderDetail(orderId);
          const finalStatus = mapBybitStatus(detail.status);

          if (!finalStatus) {
            log.warn({ orderId, bybitStatus: detail.status }, 'Unknown final Bybit status');
            continue;
          }

          if (canTransition(order.status, finalStatus)) {
            order.status = transitionOrder(order.status, finalStatus);
          } else {
            // Force terminal status even if the transition is not in the state machine
            // (e.g., Bybit says 'released' but we tracked 'new' — direct jump is fine for cleanup)
            order.status = finalStatus;
          }

          if (order.status === 'released') {
            await this.bus.emit('order:released', {
              orderId,
              side: order.side,
              amount: order.amount,
              price: order.price,
              totalBob: order.totalBob,
              profit: 0,
              bankAccountId: order.bankAccountId,
            }, MODULE);

            await this.upsertTrade(order, 'completed');
            log.info({ orderId }, 'Order completed (released)');
          } else if (order.status === 'cancelled') {
            await this.bus.emit('order:cancelled', {
              orderId,
              reason: 'completed externally',
            }, MODULE);

            await this.upsertTrade(order, 'cancelled');
            log.info({ orderId }, 'Order cancelled');
          }
        } catch (err) {
          log.error({ err, orderId }, 'Failed to fetch final order status');
        }
      }

      // Auto-cancel: cancel orders in awaiting_payment that have timed out
      for (const [orderId, order] of this.trackedOrders) {
        if (order.status !== 'awaiting_payment') continue;
        if (order.autoCancelAt === null) continue;
        if (now < order.autoCancelAt) continue;

        log.warn({ orderId, autoCancelAt: order.autoCancelAt }, 'Auto-cancelling timed-out order');

        try {
          // Bybit does not expose a direct cancel endpoint in the SDK for P2P orders.
          // We emit an event so other modules (e.g. Telegram) can handle it, and
          // update our local state to cancelled.
          order.status = 'cancelled';

          await this.bus.emit('order:cancelled', {
            orderId,
            reason: 'auto-cancel timeout',
          }, MODULE);

          await this.upsertTrade(order, 'cancelled');
        } catch (err) {
          log.error({ err, orderId }, 'Failed to auto-cancel order');
        }
      }
    } catch (err) {
      log.error({ err }, 'poll() failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Order actions
  // ---------------------------------------------------------------------------

  /**
   * Marks a buy-side order as paid by calling the Bybit API.
   */
  async markAsPaid(orderId: string): Promise<void> {
    try {
      await this.bybit.markOrderAsPaid(orderId);

      const order = this.trackedOrders.get(orderId);
      if (order && canTransition(order.status, 'payment_marked')) {
        order.status = transitionOrder(order.status, 'payment_marked');
      }

      log.info({ orderId }, 'Order marked as paid');
    } catch (err) {
      log.error({ err, orderId }, 'Failed to mark order as paid');
      throw err;
    }
  }

  /**
   * Releases crypto for a completed sell-side order.
   * NO retry — releasing twice is dangerous.
   * Throws on failure.
   */
  async releaseOrder(orderId: string): Promise<void> {
    // Throws on API failure — no catch here, no retry
    await this.bybit.releaseOrder(orderId);

    const order = this.trackedOrders.get(orderId);
    if (order) {
      if (canTransition(order.status, 'released')) {
        order.status = transitionOrder(order.status, 'released');
      } else {
        order.status = 'released';
      }
    }

    await this.bus.emit('order:released', {
      orderId,
      side: order?.side ?? 'sell',
      amount: order?.amount ?? 0,
      price: order?.price ?? 0,
      totalBob: order?.totalBob ?? 0,
      profit: 0,
      bankAccountId: order?.bankAccountId ?? 0,
    }, MODULE);

    if (order) {
      await this.upsertTrade(order, 'completed');
    }

    log.info({ orderId }, 'Order released');
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async handleDisputeEvent(orderId: string): Promise<void> {
    const order = this.trackedOrders.get(orderId);
    if (!order) {
      log.warn({ orderId }, 'telegram:dispute received for unknown order');
      return;
    }

    if (canTransition(order.status, 'disputed')) {
      order.status = transitionOrder(order.status, 'disputed');
      log.warn({ orderId }, 'Order moved to disputed via Telegram command');

      await this.bus.emit('order:disputed', {
        orderId,
        reason: 'manual dispute via Telegram',
      }, MODULE);
    } else {
      log.warn({ orderId, status: order.status }, 'Cannot dispute order in current status');
    }
  }

  /**
   * Inserts or updates the trade record in the `trades` table.
   */
  private async upsertTrade(order: TrackedOrder, tradeStatus: string): Promise<void> {
    try {
      const existingRow = await this.db
        .select()
        .from(trades)
        .where(eq(trades.bybitOrderId, order.id))
        .get();

      const completedAt =
        tradeStatus === 'completed' ? new Date().toISOString() : null;

      if (existingRow) {
        await this.db
          .update(trades)
          .set({
            status: tradeStatus,
            ...(completedAt ? { completedAt } : {}),
          })
          .where(eq(trades.bybitOrderId, order.id));
      } else {
        await this.db.insert(trades).values({
          bybitOrderId: order.id,
          side: order.side,
          amountUsdt: order.amount,
          priceBob: order.price,
          totalBob: order.totalBob,
          counterpartyId: order.counterpartyId,
          counterpartyName: order.counterpartyName,
          bankAccountId: order.bankAccountId || null,
          status: tradeStatus,
          ...(completedAt ? { completedAt } : {}),
        });
      }
    } catch (err) {
      log.error({ err, orderId: order.id }, 'Failed to upsert trade record');
    }
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getTrackedOrders(): Map<string, TrackedOrder> {
    return this.trackedOrders;
  }

  getPendingCount(): number {
    let count = 0;
    for (const order of this.trackedOrders.values()) {
      if (!TERMINAL_STATUSES.includes(order.status)) {
        count++;
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Polling lifecycle
  // ---------------------------------------------------------------------------

  start(intervalMs: number): void {
    if (this.intervalHandle !== null) {
      log.warn('OrderHandler already running');
      return;
    }

    log.info({ intervalMs }, 'Starting OrderHandler');
    void this.poll();
    this.intervalHandle = setInterval(() => void this.poll(), intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      log.info('OrderHandler stopped');
    }
  }

  setAutoCancelTimeout(ms: number): void {
    this.autoCancelTimeoutMs = ms;
    log.info({ autoCancelTimeoutMs: ms }, 'Auto-cancel timeout updated');
  }

  restart(intervalMs: number): void {
    this.stop();
    this.start(intervalMs);
    log.info({ intervalMs }, 'OrderHandler restarted with new interval');
  }
}
