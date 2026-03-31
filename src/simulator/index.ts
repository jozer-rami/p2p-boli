import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runUnit, runIntegration } from './engine.js';
import { loadBuiltinScenarios, getScenario, listScenarios } from './scenarios/index.js';
import { formatTable } from './output/table.js';
import { formatJson } from './output/json.js';
import { runAssertions, formatAssertions } from './output/assertions.js';
import type { Scenario } from './types.js';

function parseArgs(args: string[]): {
  file?: string;
  scenario?: string;
  mode: 'unit' | 'integration';
  output: 'table' | 'json';
  list: boolean;
  noAssert: boolean;
  configOverrides: Record<string, string>;
} {
  const result = {
    file: undefined as string | undefined,
    scenario: undefined as string | undefined,
    mode: 'integration' as 'unit' | 'integration',
    output: 'table' as 'table' | 'json',
    list: false,
    noAssert: false,
    configOverrides: {} as Record<string, string>,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
        result.file = args[++i];
        break;
      case '--scenario':
        result.scenario = args[++i];
        break;
      case '--mode':
        result.mode = args[++i] as 'unit' | 'integration';
        break;
      case '--output':
        result.output = args[++i] as 'table' | 'json';
        break;
      case '--list':
        result.list = true;
        break;
      case '--no-assert':
        result.noAssert = true;
        break;
      case '--config': {
        const pairs = args[++i].split(',');
        for (const pair of pairs) {
          const [key, value] = pair.split('=');
          result.configOverrides[key] = value;
        }
        break;
      }
    }
  }

  return result;
}

async function loadScenarioFromFile(filePath: string): Promise<Scenario> {
  const absPath = resolve(filePath);
  const content = await readFile(absPath, 'utf-8');
  const data = JSON.parse(content);

  if (!data.name || !data.ticks || !Array.isArray(data.ticks)) {
    throw new Error(`Invalid scenario file: missing "name" or "ticks" array`);
  }

  return {
    name: data.name,
    description: data.description ?? '',
    source: data.source,
    tickIntervalMs: data.tickIntervalMs ?? 30_000,
    ticks: data.ticks,
    expect: data.expect,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Load built-in scenarios
  await loadBuiltinScenarios();

  // List mode
  if (args.list) {
    const scenarios = listScenarios();
    console.log('\nAvailable scenarios:\n');
    for (const s of scenarios) {
      console.log(`  ${s.name.padEnd(25)} ${s.description}`);
    }
    console.log('');
    process.exit(0);
  }

  // Load scenario
  let scenario: Scenario;

  if (args.file) {
    scenario = await loadScenarioFromFile(args.file);
  } else if (args.scenario) {
    const found = getScenario(args.scenario);
    if (!found) {
      console.error(`Unknown scenario: "${args.scenario}". Use --list to see available scenarios.`);
      process.exit(2);
    }
    scenario = found;
  } else {
    console.error('Provide --file <path> or --scenario <name>. Use --list to see built-in scenarios.');
    process.exit(2);
  }

  // Apply config overrides
  const pricingConfig = {
    minSpread: parseFloat(args.configOverrides.min_spread ?? '0.015'),
    maxSpread: parseFloat(args.configOverrides.max_spread ?? '0.05'),
    tradeAmountUsdt: parseFloat(args.configOverrides.trade_amount_usdt ?? '300'),
    imbalanceThresholdUsdt: parseFloat(args.configOverrides.imbalance_threshold_usdt ?? '300'),
  };

  const volatilityConfig = {
    volatilityThresholdPercent: parseFloat(args.configOverrides.volatility_threshold_percent ?? '2'),
    volatilityWindowMinutes: parseFloat(args.configOverrides.volatility_window_minutes ?? '5'),
    gapGuardEnabled: args.configOverrides.gap_guard_enabled === 'true',
    gapGuardThresholdPercent: parseFloat(args.configOverrides.gap_guard_threshold_percent ?? '2'),
    depthGuardEnabled: args.configOverrides.depth_guard_enabled === 'true',
    depthGuardMinUsdt: parseFloat(args.configOverrides.depth_guard_min_usdt ?? '100'),
    sessionDriftGuardEnabled: args.configOverrides.session_drift_guard_enabled === 'true',
    sessionDriftThresholdPercent: parseFloat(args.configOverrides.session_drift_threshold_percent ?? '3'),
  };

  // Run simulation
  const result = args.mode === 'unit'
    ? runUnit(scenario, pricingConfig, volatilityConfig)
    : await runIntegration(scenario, pricingConfig, volatilityConfig);

  // Output
  if (args.output === 'json') {
    console.log(formatJson(result));
  } else {
    console.log(formatTable(result));
  }

  // Assertions
  let assertionsFailed = false;
  if (scenario.expect && !args.noAssert) {
    const assertionResults = runAssertions(result, scenario.expect);
    console.log(formatAssertions(assertionResults));
    assertionsFailed = assertionResults.some((r) => !r.passed);
  }

  process.exit(assertionsFailed ? 1 : 0);
}

main().catch((err) => {
  console.error('Simulation failed:', err.message);
  process.exit(2);
});
