import { describe, it, expect } from 'vitest';
import { runUnit } from '../../src/simulator/engine.js';
import type { Scenario } from '../../src/simulator/types.js';

const pricingConfig = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };

describe('simulator guards in unit mode', () => {
  it('gap guard triggers emergency after data gap with price jump', () => {
    const volatilityConfig = {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      gapGuardEnabled: true,
      gapGuardThresholdPercent: 2,
    };

    const scenario: Scenario = {
      name: 'test-gap',
      description: 'Gap bypass test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        ...Array.from({ length: 12 }, () => ({ ask: 0, bid: 0, totalAsk: 0, totalBid: 0 })),
        { ask: 7.30, bid: 7.27, totalAsk: 200, totalBid: 150 },
      ],
    };

    const result = runUnit(scenario, pricingConfig, volatilityConfig);

    const gapEvents = result.timeline.filter((t) =>
      t.events.some((e) => e.includes('gap-alert')),
    );
    expect(gapEvents.length).toBeGreaterThan(0);
    expect(result.summary.emergencyTriggered).toBe(true);
  });

  it('depth guard triggers emergency on thin book', () => {
    const volatilityConfig = {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      depthGuardEnabled: true,
      depthGuardMinUsdt: 100,
    };

    const scenario: Scenario = {
      name: 'test-depth',
      description: 'Thin book test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 50, totalBid: 40 },
      ],
    };

    const result = runUnit(scenario, pricingConfig, volatilityConfig);

    const depthEvents = result.timeline.filter((t) =>
      t.events.some((e) => e.includes('low-depth')),
    );
    expect(depthEvents.length).toBeGreaterThan(0);
    expect(result.summary.emergencyTriggered).toBe(true);
  });

  it('session drift guard triggers emergency on gradual drift', () => {
    const volatilityConfig = {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
      sessionDriftGuardEnabled: true,
      sessionDriftThresholdPercent: 3,
    };

    const scenario: Scenario = {
      name: 'test-drift',
      description: 'Staircase evasion test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        ...Array.from({ length: 4 }, () => ({ ask: 0, bid: 0, totalAsk: 0, totalBid: 0 })),
        { ask: 6.975, bid: 6.945, totalAsk: 500, totalBid: 400 },
        { ask: 6.975, bid: 6.945, totalAsk: 500, totalBid: 400 },
        ...Array.from({ length: 4 }, () => ({ ask: 0, bid: 0, totalAsk: 0, totalBid: 0 })),
        { ask: 7.031, bid: 7.001, totalAsk: 500, totalBid: 400 },
        { ask: 7.031, bid: 7.001, totalAsk: 500, totalBid: 400 },
        ...Array.from({ length: 4 }, () => ({ ask: 0, bid: 0, totalAsk: 0, totalBid: 0 })),
        { ask: 7.087, bid: 7.057, totalAsk: 500, totalBid: 400 },
        { ask: 7.087, bid: 7.057, totalAsk: 500, totalBid: 400 },
        ...Array.from({ length: 4 }, () => ({ ask: 0, bid: 0, totalAsk: 0, totalBid: 0 })),
        { ask: 7.144, bid: 7.114, totalAsk: 500, totalBid: 400 },
      ],
    };

    const result = runUnit(scenario, pricingConfig, volatilityConfig);

    const driftEvents = result.timeline.filter((t) =>
      t.events.some((e) => e.includes('session-drift')),
    );
    expect(driftEvents.length).toBeGreaterThan(0);
    expect(result.summary.emergencyTriggered).toBe(true);
  });

  it('guards do not trigger when disabled (default)', () => {
    const volatilityConfig = {
      volatilityThresholdPercent: 2,
      volatilityWindowMinutes: 5,
    };

    const scenario: Scenario = {
      name: 'test-disabled',
      description: 'Guards off test',
      tickIntervalMs: 30_000,
      ticks: [
        { ask: 6.92, bid: 6.89, totalAsk: 500, totalBid: 400 },
        { ask: 6.92, bid: 6.89, totalAsk: 5, totalBid: 5 },
      ],
    };

    const result = runUnit(scenario, pricingConfig, volatilityConfig);

    const guardEvents = result.timeline.filter((t) =>
      t.events.some((e) => e.includes('gap-alert') || e.includes('low-depth') || e.includes('session-drift')),
    );
    expect(guardEvents.length).toBe(0);
  });
});
