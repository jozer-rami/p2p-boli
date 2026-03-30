// tests/simulator/generators.test.ts
import { describe, it, expect } from 'vitest';
import {
  linearDrop,
  linearRecover,
  oscillate,
  spreadSqueeze,
  stale,
} from '../../src/simulator/scenarios/generators.js';
import type { ScenarioTick } from '../../src/simulator/types.js';

describe('linearDrop', () => {
  it('generates linearly decreasing prices over N ticks', () => {
    const ticks = linearDrop({
      from: { ask: 10.0, bid: 9.9 },
      to: { ask: 9.0, bid: 8.9 },
      ticks: 5,
    });

    expect(ticks).toHaveLength(5);
    expect(ticks[0].ask).toBeCloseTo(10.0);
    expect(ticks[0].bid).toBeCloseTo(9.9);
    expect(ticks[4].ask).toBeCloseTo(9.0);
    expect(ticks[4].bid).toBeCloseTo(8.9);
    // Monotonically decreasing
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].ask).toBeLessThan(ticks[i - 1].ask);
    }
  });

  it('defaults totalAsk/totalBid to 500', () => {
    const ticks = linearDrop({
      from: { ask: 10.0, bid: 9.9 },
      to: { ask: 9.0, bid: 8.9 },
      ticks: 2,
    });
    expect(ticks[0].totalAsk).toBe(500);
    expect(ticks[0].totalBid).toBe(500);
  });
});

describe('linearRecover', () => {
  it('generates linearly increasing prices over N ticks', () => {
    const ticks = linearRecover({
      from: { ask: 9.0, bid: 8.9 },
      to: { ask: 10.0, bid: 9.9 },
      ticks: 5,
    });

    expect(ticks).toHaveLength(5);
    expect(ticks[0].ask).toBeCloseTo(9.0);
    expect(ticks[4].ask).toBeCloseTo(10.0);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].ask).toBeGreaterThan(ticks[i - 1].ask);
    }
  });
});

describe('oscillate', () => {
  it('generates sinusoidal price swings', () => {
    const ticks = oscillate({
      center: { ask: 10.0, bid: 9.9 },
      amplitude: 0.5,
      period: 4,
      ticks: 8,
    });

    expect(ticks).toHaveLength(8);
    expect(ticks[0].ask).toBeCloseTo(10.0);
    expect(ticks[1].ask).toBeCloseTo(10.5);
    expect(ticks[2].ask).toBeCloseTo(10.0);
    expect(ticks[4].ask).toBeCloseTo(10.0);
  });
});

describe('spreadSqueeze', () => {
  it('converges ask and bid toward each other', () => {
    const ticks = spreadSqueeze({
      start: { ask: 10.0, bid: 9.8 },
      endSpread: 0.01,
      ticks: 5,
    });

    expect(ticks).toHaveLength(5);
    expect(ticks[0].ask - ticks[0].bid).toBeCloseTo(0.2);
    expect(ticks[4].ask - ticks[4].bid).toBeCloseTo(0.01, 2);
    const mid0 = (ticks[0].ask + ticks[0].bid) / 2;
    const mid4 = (ticks[4].ask + ticks[4].bid) / 2;
    expect(mid0).toBeCloseTo(mid4, 2);
  });
});

describe('stale', () => {
  it('generates ticks with zero ask/bid to simulate data outage', () => {
    const ticks = stale(3);

    expect(ticks).toHaveLength(3);
    for (const tick of ticks) {
      expect(tick.ask).toBe(0);
      expect(tick.bid).toBe(0);
      expect(tick.totalAsk).toBe(0);
      expect(tick.totalBid).toBe(0);
    }
  });
});
