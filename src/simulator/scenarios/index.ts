// src/simulator/scenarios/index.ts

import type { Scenario, ScenarioExpectations } from '../types.js';

interface DefineScenarioInput {
  name: string;
  description: string;
  source?: string;
  tickIntervalMs?: number;
  ticks: import('../types.js').ScenarioTick[];
  expect?: ScenarioExpectations;
}

export function defineScenario(input: DefineScenarioInput): Scenario {
  return {
    tickIntervalMs: 30_000,
    ...input,
  };
}

const registry = new Map<string, Scenario>();

export function registerScenario(scenario: Scenario): void {
  registry.set(scenario.name, scenario);
}

export function getScenario(name: string): Scenario | undefined {
  return registry.get(name);
}

export function listScenarios(): Scenario[] {
  return Array.from(registry.values());
}

export async function loadBuiltinScenarios(): Promise<void> {
  const modules = import.meta.glob<{ default: Scenario }>('./*.ts', { eager: true });
  for (const [path, mod] of Object.entries(modules)) {
    const filename = path.split('/').pop() ?? '';
    if (filename === 'index.ts' || filename === 'generators.ts') continue;
    if (mod.default) {
      registerScenario(mod.default);
    }
  }
}
