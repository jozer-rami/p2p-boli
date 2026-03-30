// src/simulator/output/json.ts

import type { SimulationResult } from '../types.js';

export function formatJson(result: SimulationResult): string {
  return JSON.stringify(result, null, 2);
}
