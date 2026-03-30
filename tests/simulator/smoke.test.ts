// tests/simulator/smoke.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { runUnit, runIntegration } from '../../src/simulator/engine.js';
import { loadBuiltinScenarios, getScenario, listScenarios } from '../../src/simulator/scenarios/index.js';
import { runAssertions } from '../../src/simulator/output/assertions.js';
import { formatTable } from '../../src/simulator/output/table.js';

beforeAll(async () => {
  await loadBuiltinScenarios();
});

describe('simulator smoke tests', () => {
  it('has all built-in scenarios registered', () => {
    const scenarios = listScenarios();
    expect(scenarios.length).toBe(11);
    expect(scenarios.map((s) => s.name)).toContain('flash-crash-5pct');
    expect(scenarios.map((s) => s.name)).toContain('spread-inversion');
    expect(scenarios.map((s) => s.name)).toContain('oscillation');
  });

  it('runs flash-crash-5pct in unit mode end-to-end', () => {
    const scenario = getScenario('flash-crash-5pct')!;
    const config = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };
    const volConfig = { volatilityThresholdPercent: 2, volatilityWindowMinutes: 5 };

    const result = runUnit(scenario, config, volConfig);

    expect(result.timeline.length).toBe(scenario.ticks.length);
    expect(result.summary.emergencyTriggered).toBe(true);

    // Table output should not throw
    const table = formatTable(result);
    expect(table).toContain('flash-crash-5pct');

    // Assertions should pass
    if (scenario.expect) {
      const assertions = runAssertions(result, scenario.expect);
      for (const a of assertions) {
        expect(a.passed).toBe(true);
      }
    }
  });

  it('runs flash-crash-5pct in integration mode end-to-end', async () => {
    const scenario = getScenario('flash-crash-5pct')!;
    const config = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };
    const volConfig = { volatilityThresholdPercent: 2, volatilityWindowMinutes: 5 };

    const result = await runIntegration(scenario, config, volConfig);

    expect(result.mode).toBe('integration');
    expect(result.timeline.length).toBe(scenario.ticks.length);
  });

  it('runs spread-inversion and detects the inversion', () => {
    const scenario = getScenario('spread-inversion')!;
    const config = { minSpread: 0.015, maxSpread: 0.05, tradeAmountUsdt: 300 };
    const volConfig = { volatilityThresholdPercent: 2, volatilityWindowMinutes: 5 };

    const result = runUnit(scenario, config, volConfig);

    // Should have paused entries where bid > ask
    const pausedTicks = result.timeline.filter((t) => t.paused);
    expect(pausedTicks.length).toBeGreaterThan(0);
  });
});
