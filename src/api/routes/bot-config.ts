import { Router } from 'express';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('api:bot-config');

export interface BotConfigDeps {
  getConfig: (key: string) => string;
  setConfig: (key: string, value: string) => void;
  adManager: {
    setPaused: (side: 'buy' | 'sell', paused: boolean) => void;
    updateConfig: (config: { tradeAmountUsdt?: number }) => void;
    setRepriceEnabled: (enabled: boolean) => void;
    restart: (intervalMs: number) => void;
  };
  orderHandler: {
    setAutoCancelTimeout: (ms: number) => void;
    restart: (intervalMs: number) => void;
  };
  priceMonitor: {
    setVolatilityConfig: (config: { thresholdPercent?: number; windowMinutes?: number }) => void;
    restart: (intervalMs: number) => void;
  };
  emergencyStop: {
    getState: () => string;
    setState: (state: 'running' | 'paused' | 'emergency') => void;
    trigger: (type: string, reason: string) => void;
    resolve: (by: string) => void;
  };
}

function buildResponse(getConfig: (key: string) => string) {
  return {
    trading: {
      activeSides: getConfig('active_sides'),
      tradeAmountUsdt: parseFloat(getConfig('trade_amount_usdt')),
      repriceEnabled: getConfig('reprice_enabled') === 'true',
      autoCancelTimeoutMs: parseInt(getConfig('auto_cancel_timeout_ms')),
    },
    schedule: {
      sleepStartHour: parseInt(getConfig('sleep_start_hour')),
      sleepEndHour: parseInt(getConfig('sleep_end_hour')),
    },
    volatility: {
      thresholdPercent: parseFloat(getConfig('volatility_threshold_percent')),
      windowMinutes: parseFloat(getConfig('volatility_window_minutes')),
    },
    messaging: {
      qrPreMessage: getConfig('qr_pre_message'),
    },
    polling: {
      ordersMs: parseInt(getConfig('poll_interval_orders_ms')),
      adsMs: parseInt(getConfig('poll_interval_ads_ms')),
      pricesMs: parseInt(getConfig('poll_interval_prices_ms')),
    },
    botState: getConfig('bot_state'),
  };
}

export function createBotConfigRouter(deps: BotConfigDeps): Router {
  const router = Router();

  router.get('/config/bot', (_req, res) => {
    res.json(buildResponse(deps.getConfig));
  });

  router.put('/config/bot', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      res.status(400).json({ error: 'Request body must be a non-empty object' });
      return;
    }

    try {
      if (body.trading) {
        const t = body.trading;
        if (t.activeSides !== undefined) {
          deps.setConfig('active_sides', String(t.activeSides));
          if (t.activeSides === 'sell') {
            deps.adManager.setPaused('buy', true);
            deps.adManager.setPaused('sell', false);
          } else if (t.activeSides === 'buy') {
            deps.adManager.setPaused('sell', true);
            deps.adManager.setPaused('buy', false);
          } else {
            deps.adManager.setPaused('buy', false);
            deps.adManager.setPaused('sell', false);
          }
        }
        if (t.tradeAmountUsdt !== undefined) {
          deps.setConfig('trade_amount_usdt', String(t.tradeAmountUsdt));
          deps.adManager.updateConfig({ tradeAmountUsdt: Number(t.tradeAmountUsdt) });
        }
        if (t.repriceEnabled !== undefined) {
          deps.setConfig('reprice_enabled', String(t.repriceEnabled));
          deps.adManager.setRepriceEnabled(Boolean(t.repriceEnabled));
        }
        if (t.autoCancelTimeoutMs !== undefined) {
          deps.setConfig('auto_cancel_timeout_ms', String(t.autoCancelTimeoutMs));
          deps.orderHandler.setAutoCancelTimeout(Number(t.autoCancelTimeoutMs));
        }
      }

      if (body.schedule) {
        const s = body.schedule;
        if (s.sleepStartHour !== undefined) deps.setConfig('sleep_start_hour', String(s.sleepStartHour));
        if (s.sleepEndHour !== undefined) deps.setConfig('sleep_end_hour', String(s.sleepEndHour));
      }

      if (body.volatility) {
        const v = body.volatility;
        const updates: { thresholdPercent?: number; windowMinutes?: number } = {};
        if (v.thresholdPercent !== undefined) {
          deps.setConfig('volatility_threshold_percent', String(v.thresholdPercent));
          updates.thresholdPercent = Number(v.thresholdPercent);
        }
        if (v.windowMinutes !== undefined) {
          deps.setConfig('volatility_window_minutes', String(v.windowMinutes));
          updates.windowMinutes = Number(v.windowMinutes);
        }
        if (Object.keys(updates).length > 0) {
          deps.priceMonitor.setVolatilityConfig(updates);
        }
      }

      if (body.messaging) {
        if (body.messaging.qrPreMessage !== undefined) {
          deps.setConfig('qr_pre_message', String(body.messaging.qrPreMessage));
        }
      }

      if (body.polling) {
        const p = body.polling;
        if (p.ordersMs !== undefined) {
          deps.setConfig('poll_interval_orders_ms', String(p.ordersMs));
          deps.orderHandler.restart(Number(p.ordersMs));
        }
        if (p.adsMs !== undefined) {
          deps.setConfig('poll_interval_ads_ms', String(p.adsMs));
          deps.adManager.restart(Number(p.adsMs));
        }
        if (p.pricesMs !== undefined) {
          deps.setConfig('poll_interval_prices_ms', String(p.pricesMs));
          deps.priceMonitor.restart(Number(p.pricesMs));
        }
      }

      if (body.botState !== undefined) {
        deps.setConfig('bot_state', String(body.botState));
        if (body.botState === 'paused') {
          deps.emergencyStop.setState('paused');
          deps.adManager.setPaused('buy', true);
          deps.adManager.setPaused('sell', true);
        } else if (body.botState === 'running') {
          deps.emergencyStop.setState('running');
          deps.adManager.setPaused('buy', false);
          deps.adManager.setPaused('sell', false);
          if (deps.emergencyStop.getState() === 'emergency') {
            deps.emergencyStop.resolve('dashboard');
          }
        }
      }

      log.info({ keys: Object.keys(body) }, 'Bot config updated');
      res.json({ ok: true, config: buildResponse(deps.getConfig) });
    } catch (err) {
      log.error({ err }, 'Failed to update bot config');
      res.status(500).json({ error: 'Failed to update bot config' });
    }
  });

  return router;
}
