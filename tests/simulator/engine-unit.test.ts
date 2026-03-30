// tests/simulator/engine-unit.test.ts
import { describe, it, expect } from 'vitest';
import { runUnit } from '../../src/simulator/engine.js';
import type { Scenario } from '../../src/simulator/types.js';

describe('runUnit', () => {
  const config = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };
  const volatilityConfig = { volatilityThresholdPercent: 2, volatilityWindowMinutes: 5 };

  it('produces a timeline entry per tick with pricing results', () => {
    const scenario: Scenario = {
      name: 'test-basic',
      description: 'Basic pricing test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
        { ask: 6.910, bid: 6.875, totalAsk: 300, totalBid: 200 },
      ],
    };

    const result = runUnit(scenario, config, volatilityConfig);

    expect(result.timeline).toHaveLength(2);
    expect(result.timeline[0].tick).toBe(1);
    expect(result.timeline[0].buyPrice).toBeTypeOf('number');
    expect(result.timeline[0].sellPrice).toBeTypeOf('number');
    expect(result.timeline[0].elapsed).toBe('00:00:00');
    expect(result.timeline[1].elapsed).toBe('00:00:30');
  });

  it('detects volatility when price changes exceed threshold', () => {
    const scenario: Scenario = {
      name: 'test-volatility',
      description: 'Volatility detection',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.900, totalAsk: 500, totalBid: 500 },
        { ask: 6.850, bid: 6.830, totalAsk: 500, totalBid: 500 },
        { ask: 6.780, bid: 6.760, totalAsk: 500, totalBid: 500 },
        { ask: 6.710, bid: 6.690, totalAsk: 500, totalBid: 500 },
      ],
    };

    const result = runUnit(scenario, config, volatilityConfig);

    const volatilityEvents = result.timeline.filter((t) =>
      t.events.some((e) => e.includes('volatility')),
    );
    expect(volatilityEvents.length).toBeGreaterThan(0);
  });

  it('marks paused when no valid prices (stale tick)', () => {
    const scenario: Scenario = {
      name: 'test-stale',
      description: 'Stale data test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
        { ask: 0, bid: 0, totalAsk: 0, totalBid: 0 },
      ],
    };

    const result = runUnit(scenario, config, volatilityConfig);

    expect(result.timeline[1].paused).toBe(true);
    expect(result.timeline[1].buyPrice).toBeNull();
    expect(result.timeline[1].sellPrice).toBeNull();
  });

  it('populates summary correctly', () => {
    const scenario: Scenario = {
      name: 'test-summary',
      description: 'Summary test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.920, bid: 6.890, totalAsk: 500, totalBid: 400 },
        { ask: 6.910, bid: 6.875, totalAsk: 300, totalBid: 200 },
      ],
    };

    const result = runUnit(scenario, config, volatilityConfig);

    expect(result.summary.totalTicks).toBe(2);
    expect(result.summary.simulatedDuration).toBe('00:00:30');
    expect(result.mode).toBe('unit');
    expect(result.scenario).toBe('test-summary');
  });
});
