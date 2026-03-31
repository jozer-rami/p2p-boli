import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBotConfigRouter } from '../../src/api/routes/bot-config.js';

function createMockDeps() {
  return {
    getConfig: vi.fn((key: string) => {
      const defaults: Record<string, string> = {
        active_sides: 'both',
        trade_amount_usdt: '300',
        reprice_enabled: 'true',
        auto_cancel_timeout_ms: '900000',
        sleep_start_hour: '23',
        sleep_end_hour: '10',
        volatility_threshold_percent: '2',
        volatility_window_minutes: '5',
        qr_pre_message: 'Hola!',
        poll_interval_orders_ms: '5000',
        poll_interval_ads_ms: '30000',
        poll_interval_prices_ms: '30000',
        bot_state: 'running',
      };
      return defaults[key] ?? '';
    }),
    setConfig: vi.fn(),
    adManager: {
      setPaused: vi.fn(),
      updateConfig: vi.fn(),
      setRepriceEnabled: vi.fn(),
      restart: vi.fn(),
    },
    orderHandler: {
      setAutoCancelTimeout: vi.fn(),
      restart: vi.fn(),
    },
    priceMonitor: {
      setVolatilityConfig: vi.fn(),
      restart: vi.fn(),
    },
    emergencyStop: {
      getState: vi.fn(() => 'running'),
      setState: vi.fn(),
      trigger: vi.fn(),
      resolve: vi.fn(),
    },
  };
}

describe('Bot Config API', () => {
  function createApp(deps = createMockDeps()) {
    const app = express();
    app.use(express.json());
    app.use('/api', createBotConfigRouter(deps as any));
    return { app, deps };
  }

  describe('GET /api/config/bot', () => {
    it('returns grouped config', async () => {
      const { app } = createApp();
      const res = await request(app).get('/api/config/bot');

      expect(res.status).toBe(200);
      expect(res.body.trading.activeSides).toBe('both');
      expect(res.body.trading.tradeAmountUsdt).toBe(300);
      expect(res.body.trading.repriceEnabled).toBe(true);
      expect(res.body.trading.autoCancelTimeoutMs).toBe(900000);
      expect(res.body.schedule.sleepStartHour).toBe(23);
      expect(res.body.schedule.sleepEndHour).toBe(10);
      expect(res.body.volatility.thresholdPercent).toBe(2);
      expect(res.body.volatility.windowMinutes).toBe(5);
      expect(res.body.messaging.qrPreMessage).toBe('Hola!');
      expect(res.body.polling.ordersMs).toBe(5000);
      expect(res.body.botState).toBe('running');
    });
  });

  describe('PUT /api/config/bot', () => {
    it('updates trading config and hot-reloads', async () => {
      const { app, deps } = createApp();
      const res = await request(app)
        .put('/api/config/bot')
        .send({ trading: { activeSides: 'sell', tradeAmountUsdt: 500 } });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(deps.setConfig).toHaveBeenCalledWith('active_sides', 'sell');
      expect(deps.setConfig).toHaveBeenCalledWith('trade_amount_usdt', '500');
      expect(deps.adManager.setPaused).toHaveBeenCalled();
    });

    it('updates polling and restarts modules', async () => {
      const { app, deps } = createApp();
      const res = await request(app)
        .put('/api/config/bot')
        .send({ polling: { ordersMs: 10000, adsMs: 60000 } });

      expect(res.status).toBe(200);
      expect(deps.setConfig).toHaveBeenCalledWith('poll_interval_orders_ms', '10000');
      expect(deps.orderHandler.restart).toHaveBeenCalledWith(10000);
      expect(deps.adManager.restart).toHaveBeenCalledWith(60000);
    });

    it('updates volatility and hot-reloads PriceMonitor', async () => {
      const { app, deps } = createApp();
      const res = await request(app)
        .put('/api/config/bot')
        .send({ volatility: { thresholdPercent: 5 } });

      expect(res.status).toBe(200);
      expect(deps.priceMonitor.setVolatilityConfig).toHaveBeenCalledWith({ thresholdPercent: 5 });
    });

    it('pauses bot when botState set to paused', async () => {
      const { app, deps } = createApp();
      const res = await request(app)
        .put('/api/config/bot')
        .send({ botState: 'paused' });

      expect(res.status).toBe(200);
      expect(deps.adManager.setPaused).toHaveBeenCalledWith('buy', true);
      expect(deps.adManager.setPaused).toHaveBeenCalledWith('sell', true);
    });

    it('resumes bot when botState set to running', async () => {
      const deps = createMockDeps();
      deps.emergencyStop.getState.mockReturnValue('emergency');
      const { app } = createApp(deps);

      const res = await request(app)
        .put('/api/config/bot')
        .send({ botState: 'running' });

      expect(res.status).toBe(200);
      expect(deps.adManager.setPaused).toHaveBeenCalledWith('buy', false);
      expect(deps.adManager.setPaused).toHaveBeenCalledWith('sell', false);
      expect(deps.emergencyStop.resolve).toHaveBeenCalledWith('dashboard');
    });

    it('returns 400 for empty body', async () => {
      const { app } = createApp();
      const res = await request(app).put('/api/config/bot').send({});
      expect(res.status).toBe(400);
    });
  });
});
