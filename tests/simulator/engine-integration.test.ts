// tests/simulator/engine-integration.test.ts
import { describe, it, expect } from 'vitest';
import { runIntegration } from '../../src/simulator/engine.js';
import type { Scenario } from '../../src/simulator/types.js';

describe('runIntegration', () => {
  const config = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };
  const volatilityConfig = { volatilityThresholdPercent: 2, volatilityWindowMinutes: 5 };

  it('runs scenario through full module stack and captures events', async () => {
    const scenario: Scenario = {
      name: 'integration-basic',
      description: 'Basic integration test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
        { ask: 6.910, bid: 6.875, totalAsk: 300, totalBid: 200 },
        { ask: 6.900, bid: 6.860, totalAsk: 300, totalBid: 200 },
      ],
    };

    const result = await runIntegration(scenario, config, volatilityConfig);

    expect(result.mode).toBe('integration');
    expect(result.timeline).toHaveLength(3);
    expect(result.summary.totalTicks).toBe(3);
  });

  it('triggers emergency stop on flash crash', async () => {
    const scenario: Scenario = {
      name: 'integration-crash',
      description: 'Flash crash triggers emergency',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.900, totalAsk: 500, totalBid: 500 },
        { ask: 6.850, bid: 6.830, totalAsk: 500, totalBid: 500 },
        { ask: 6.780, bid: 6.760, totalAsk: 500, totalBid: 500 },
        { ask: 6.710, bid: 6.690, totalAsk: 500, totalBid: 500 },
        { ask: 6.640, bid: 6.620, totalAsk: 500, totalBid: 500 },
      ],
    };

    const result = await runIntegration(scenario, config, volatilityConfig);

    expect(result.summary.emergencyTriggered).toBe(true);
  });

  it('captures ad operations from MockBybitClient in timeline', async () => {
    const scenario: Scenario = {
      name: 'integration-ads',
      description: 'Ad operations tracking',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
        { ask: 6.910, bid: 6.875, totalAsk: 300, totalBid: 200 },
      ],
    };

    const result = await runIntegration(scenario, config, volatilityConfig);

    const allEvents = result.timeline.flatMap((t) => t.events);
    expect(allEvents.length).toBeGreaterThan(0);
  });
});
