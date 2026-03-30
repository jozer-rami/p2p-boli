// src/simulator/output/assertions.ts

import type { SimulationResult, ScenarioExpectations } from '../types.js';

export interface AssertionResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export function runAssertions(
  result: SimulationResult,
  expectations: ScenarioExpectations,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (expectations.emergencyTriggered !== undefined) {
    results.push({
      name: 'emergencyTriggered',
      passed: result.summary.emergencyTriggered === expectations.emergencyTriggered,
      expected: String(expectations.emergencyTriggered),
      actual: String(result.summary.emergencyTriggered),
    });
  }

  if (expectations.emergencyByTick !== undefined) {
    const actual = result.summary.emergencyAtTick;
    const passed = actual !== null && actual <= expectations.emergencyByTick;
    results.push({
      name: 'emergencyByTick',
      passed,
      expected: `<= ${expectations.emergencyByTick}`,
      actual: actual !== null ? `tick ${actual}` : 'no emergency',
    });
  }

  if (expectations.maxRepricesBeforeEmergency !== undefined) {
    const emergencyTick = result.summary.emergencyAtTick ?? result.summary.totalTicks + 1;
    const repricesBeforeEmergency = result.timeline
      .filter((t) => t.tick < emergencyTick)
      .filter((t) => t.events.some((e) => e.includes('repriced')))
      .length;
    const passed = repricesBeforeEmergency <= expectations.maxRepricesBeforeEmergency;
    results.push({
      name: 'maxRepricesBeforeEmergency',
      passed,
      expected: `<= ${expectations.maxRepricesBeforeEmergency}`,
      actual: String(repricesBeforeEmergency),
    });
  }

  if (expectations.noAdsActiveDuring !== undefined) {
    const [startTick, endTick] = expectations.noAdsActiveDuring;
    const violatingTicks = result.timeline
      .filter((t) => t.tick >= startTick && t.tick <= endTick)
      .filter((t) => t.buyPrice !== null || t.sellPrice !== null);
    results.push({
      name: 'noAdsActiveDuring',
      passed: violatingTicks.length === 0,
      expected: `no ads active during ticks ${startTick}-${endTick}`,
      actual: violatingTicks.length === 0
        ? 'no ads active'
        : `ads active at ticks ${violatingTicks.map((t) => t.tick).join(', ')}`,
    });
  }

  if (expectations.spreadNeverBelow !== undefined) {
    const violatingSpreads = result.timeline
      .filter((t) => t.botSpread !== null && t.botSpread < expectations.spreadNeverBelow!);
    results.push({
      name: 'spreadNeverBelow',
      passed: violatingSpreads.length === 0,
      expected: `>= ${expectations.spreadNeverBelow}`,
      actual: violatingSpreads.length === 0
        ? 'all spreads above threshold'
        : `spread ${Math.min(...violatingSpreads.map((t) => t.botSpread!))} at tick ${violatingSpreads[0].tick}`,
    });
  }

  return results;
}

export function formatAssertions(results: AssertionResult[]): string {
  const lines = results.map((r) => {
    const icon = r.passed ? '\u2713' : '\u2717';
    return `  ${icon} ${r.name}: ${r.passed ? 'passed' : 'FAILED'} (expected: ${r.expected}, actual: ${r.actual})`;
  });

  const passCount = results.filter((r) => r.passed).length;
  lines.push('');
  lines.push(`  ${passCount}/${results.length} assertions passed`);

  return lines.join('\n');
}
