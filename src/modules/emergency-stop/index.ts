import type { DB } from '../../db/index.js';
import type { EventBus } from '../../event-bus.js';
import { createModuleLogger } from '../../utils/logger.js';
import type { EmergencyTrigger, BotState } from './types.js';

const log = createModuleLogger('emergency-stop');

const MODULE = 'EmergencyStop';

export interface EmergencyDeps {
  removeAllAds: () => Promise<void>;
  getExposure: () => Promise<{ usdt: number; bob: number }>;
  getMarketState: () => { ask: number; bid: number };
  getPendingOrderCount: () => number;
  stopPolling: () => void;
  startPolling: () => void;
}

export class EmergencyStop {
  private readonly bus: EventBus;
  private readonly db: DB;
  private readonly deps: EmergencyDeps;
  private state: BotState = 'running';

  constructor(bus: EventBus, db: DB, deps: EmergencyDeps) {
    this.bus = bus;
    this.db = db;
    this.deps = deps;

    this.bus.on('price:volatility-alert', (payload) => {
      return this.trigger('volatility', `Price changed ${payload.changePercent.toFixed(2)}% in ${payload.windowMinutes}min`);
    });

    this.bus.on('price:stale', (payload) => {
      return this.trigger('stale_data', `Price data stale for ${payload.staleDurationSeconds}s`);
    });

    this.bus.on('ad:spread-inversion', (payload) => {
      return this.trigger('spread_inversion', `Spread inverted: buy=${payload.buyPrice} sell=${payload.sellPrice}`);
    });

    this.bus.on('telegram:emergency', () => {
      return this.trigger('manual', 'Manual emergency triggered via Telegram');
    });
  }

  async trigger(type: EmergencyTrigger, reason: string): Promise<void> {
    if (this.state === 'emergency') {
      log.warn({ type, reason }, 'Emergency already active — ignoring trigger');
      return;
    }

    log.error({ type, reason }, 'Emergency triggered');
    this.state = 'emergency';

    try {
      await this.deps.removeAllAds();
    } catch (err) {
      log.error({ err }, 'Failed to remove all ads during emergency');
    }

    this.deps.stopPolling();

    const exposure = await this.deps.getExposure().catch(() => ({ usdt: 0, bob: 0 }));
    const marketState = this.deps.getMarketState();

    await this.bus.emit(
      'emergency:triggered',
      {
        reason,
        trigger: type,
        marketState,
        exposure,
      },
      MODULE,
    );
  }

  async resolve(resumedBy: string): Promise<void> {
    log.info({ resumedBy }, 'Emergency resolved');
    this.state = 'running';

    this.deps.startPolling();

    await this.bus.emit('emergency:resolved', { resumedBy }, MODULE);
  }

  getState(): BotState {
    return this.state;
  }

  setState(state: BotState): void {
    this.state = state;
  }
}
