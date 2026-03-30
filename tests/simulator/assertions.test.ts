// tests/simulator/assertions.test.ts
import { describe, it, expect } from 'vitest';
import { runAssertions } from '../../src/simulator/output/assertions.js';
import type { SimulationResult, ScenarioExpectations } from '../../src/simulator/types.js';

function makeResult(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    scenario: 'test',
    mode: 'unit',
    timeline: [
      { tick: 1, elapsed: '00:00:00', ask: 6.92, bid: 6.89, marketSpread: 0.03, buyPrice: 6.89, sellPrice: 6.92, botSpread: 0.03, events: ['priced(buy:6.890,sell:6.920)'], paused: false },
      { tick: 2, elapsed: '00:00:30', ask: 6.91, bid: 6.87, marketSpread: 0.04, buyPrice: 6.87, sellPrice: 6.91, botSpread: 0.04, events: ['repriced(buy:6.870,sell:6.910)'], paused: false },
      { tick: 3, elapsed: '00:01:00', ask: 6.85, bid: 6.80, marketSpread: 0.05, buyPrice: null, sellPrice: null, botSpread: null, events: ['volatility-alert(3.2%)', 'emergency:triggered(volatility)'], paused: true, pauseReason: 'no valid market prices' },
    ],
    summary: {
      totalTicks: 3,
      simulatedDuration: '00:01:00',
      repriceCount: 1,
      pauseCount: 1,
      emergencyTriggered: true,
      emergencyAtTick: 3,
      emergencyReason: 'emergency:triggered(volatility)',
      maxSpread: 0.04,
      minSpread: 0.03,
    },
    ...overrides,
  };
}

describe('runAssertions', () => {
  it('passes when emergencyTriggered matches', () => {
    const expectations: ScenarioExpectations = { emergencyTriggered: true };
    const results = runAssertions(makeResult(), expectations);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('fails when emergencyTriggered does not match', () => {
    const expectations: ScenarioExpectations = { emergencyTriggered: false };
    const results = runAssertions(makeResult(), expectations);
    expect(results.some((r) => !r.passed)).toBe(true);
  });

  it('passes emergencyByTick when emergency is early enough', () => {
    const expectations: ScenarioExpectations = { emergencyByTick: 5 };
    const results = runAssertions(makeResult(), expectations);
    const byTick = results.find((r) => r.name === 'emergencyByTick');
    expect(byTick?.passed).toBe(true);
  });

  it('fails emergencyByTick when emergency is too late', () => {
    const expectations: ScenarioExpectations = { emergencyByTick: 2 };
    const results = runAssertions(makeResult(), expectations);
    const byTick = results.find((r) => r.name === 'emergencyByTick');
    expect(byTick?.passed).toBe(false);
  });

  it('passes spreadNeverBelow when all spreads are above threshold', () => {
    const expectations: ScenarioExpectations = { spreadNeverBelow: 0.02 };
    const results = runAssertions(makeResult(), expectations);
    const spread = results.find((r) => r.name === 'spreadNeverBelow');
    expect(spread?.passed).toBe(true);
  });

  it('fails spreadNeverBelow when a spread is below threshold', () => {
    const expectations: ScenarioExpectations = { spreadNeverBelow: 0.035 };
    const results = runAssertions(makeResult(), expectations);
    const spread = results.find((r) => r.name === 'spreadNeverBelow');
    expect(spread?.passed).toBe(false);
  });

  it('checks maxRepricesBeforeEmergency', () => {
    const expectations: ScenarioExpectations = { maxRepricesBeforeEmergency: 5 };
    const results = runAssertions(makeResult(), expectations);
    const reprices = results.find((r) => r.name === 'maxRepricesBeforeEmergency');
    expect(reprices?.passed).toBe(true);
  });

  it('checks noAdsActiveDuring', () => {
    const expectations: ScenarioExpectations = { noAdsActiveDuring: [3, 3] };
    const results = runAssertions(makeResult(), expectations);
    const noAds = results.find((r) => r.name === 'noAdsActiveDuring');
    expect(noAds?.passed).toBe(true);
  });
});
