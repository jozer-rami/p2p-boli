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

// Scenarios are registered explicitly here. Each scenario file exports a default Scenario.
// New scenarios: import and add to the BUILTIN_SCENARIOS array.
const BUILTIN_SCENARIOS: Array<() => Promise<{ default: Scenario }>> = [
  () => import('./flash-crash-5pct.js'),
  () => import('./flash-crash-10pct.js'),
  () => import('./spread-squeeze.js'),
  () => import('./spread-inversion.js'),
  () => import('./oscillation.js'),
  () => import('./slow-drift.js'),
  () => import('./stale-then-spike.js'),
  () => import('./thin-book.js'),
  () => import('./stale-gap-bypass.js'),
  () => import('./thin-book-crash.js'),
  () => import('./repeated-micro-gaps.js'),
];

export async function loadBuiltinScenarios(): Promise<void> {
  for (const loader of BUILTIN_SCENARIOS) {
    const mod = await loader();
    registerScenario(mod.default);
  }
}
