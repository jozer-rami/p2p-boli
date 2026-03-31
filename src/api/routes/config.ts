import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { config } from '../../db/schema.js';
import { DEFAULT_CONFIG, type ConfigKey } from '../../config.js';
import { createModuleLogger } from '../../utils/logger.js';
import type { DB } from '../../db/index.js';

const log = createModuleLogger('api:config');

// Guard-related config keys that can be updated via this endpoint
const GUARD_KEYS = [
  'gap_guard_enabled',
  'gap_guard_threshold_percent',
  'depth_guard_enabled',
  'depth_guard_min_usdt',
  'session_drift_guard_enabled',
  'session_drift_threshold_percent',
] as const satisfies readonly ConfigKey[];

type GuardKey = (typeof GUARD_KEYS)[number];

function isGuardKey(key: string): key is GuardKey {
  return (GUARD_KEYS as readonly string[]).includes(key);
}

export interface ConfigDeps {
  db: DB;
  priceMonitor: {
    updateGuardConfig: (updates: Record<string, unknown>) => void;
    getGuardConfig: () => Record<string, unknown>;
  };
}

export function createConfigRouter(deps: ConfigDeps): Router {
  const router = Router();

  // GET /config/guards — read all guard config values
  router.get('/config/guards', async (_req, res) => {
    try {
      const guardConfig = deps.priceMonitor.getGuardConfig();
      res.json(guardConfig);
    } catch (err) {
      log.error({ err }, 'Failed to read guard config');
      res.status(500).json({ error: 'Failed to read guard config' });
    }
  });

  // PATCH /config/guards — update one or more guard config values
  router.patch('/config/guards', async (req, res) => {
    const updates = req.body;

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'Request body must be a non-empty object' });
      return;
    }

    // Map camelCase request keys to snake_case config keys
    const keyMap: Record<string, GuardKey> = {
      gapGuardEnabled: 'gap_guard_enabled',
      gapGuardThresholdPercent: 'gap_guard_threshold_percent',
      depthGuardEnabled: 'depth_guard_enabled',
      depthGuardMinUsdt: 'depth_guard_min_usdt',
      sessionDriftGuardEnabled: 'session_drift_guard_enabled',
      sessionDriftThresholdPercent: 'session_drift_threshold_percent',
    };

    const dbUpdates: Array<{ key: GuardKey; value: string }> = [];
    const runtimeUpdates: Record<string, unknown> = {};

    for (const [camelKey, value] of Object.entries(updates)) {
      const snakeKey = keyMap[camelKey];
      if (!snakeKey || !isGuardKey(snakeKey)) {
        res.status(400).json({ error: `Unknown guard config key: ${camelKey}` });
        return;
      }
      dbUpdates.push({ key: snakeKey, value: String(value) });
      runtimeUpdates[camelKey] = value;
    }

    try {
      // Persist to DB
      for (const { key, value } of dbUpdates) {
        await deps.db
          .insert(config)
          .values({ key, value, updatedAt: new Date().toISOString() })
          .onConflictDoUpdate({
            target: config.key,
            set: { value, updatedAt: new Date().toISOString() },
          });
      }

      // Update running PriceMonitor
      deps.priceMonitor.updateGuardConfig(runtimeUpdates);

      log.info({ updates: Object.keys(updates) }, 'Guard config updated');
      res.json({ success: true, updated: deps.priceMonitor.getGuardConfig() });
    } catch (err) {
      log.error({ err }, 'Failed to update guard config');
      res.status(500).json({ error: 'Failed to update guard config' });
    }
  });

  return router;
}
