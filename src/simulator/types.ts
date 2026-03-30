// src/simulator/types.ts

import type { PlatformPrices } from '../event-bus.js';

/** A single price snapshot in a scenario */
export interface ScenarioTick {
  ask: number;
  bid: number;
  totalAsk: number;
  totalBid: number;
}

/** Assertion expectations for a scenario run */
export interface ScenarioExpectations {
  emergencyTriggered?: boolean;
  emergencyByTick?: number;
  maxRepricesBeforeEmergency?: number;
  noAdsActiveDuring?: [number, number];
  spreadNeverBelow?: number;
}

/** Full scenario definition */
export interface Scenario {
  name: string;
  description: string;
  source?: string;
  tickIntervalMs: number;
  ticks: ScenarioTick[];
  expect?: ScenarioExpectations;
}

/** A single entry in the simulation timeline */
export interface TimelineEntry {
  tick: number;
  elapsed: string;
  ask: number;
  bid: number;
  marketSpread: number;
  buyPrice: number | null;
  sellPrice: number | null;
  botSpread: number | null;
  events: string[];
  paused: boolean;
  pauseReason?: string;
}

/** Full simulation result */
export interface SimulationResult {
  scenario: string;
  mode: 'unit' | 'integration';
  timeline: TimelineEntry[];
  summary: SimulationSummary;
}

export interface SimulationSummary {
  totalTicks: number;
  simulatedDuration: string;
  repriceCount: number;
  pauseCount: number;
  emergencyTriggered: boolean;
  emergencyAtTick: number | null;
  emergencyReason: string | null;
  maxSpread: number;
  minSpread: number;
}

/** Convert a ScenarioTick to PlatformPrices for module consumption */
export function tickToPlatformPrices(tick: ScenarioTick, timeMs: number): PlatformPrices {
  return {
    platform: 'bybitp2p',
    ask: tick.ask,
    totalAsk: tick.totalAsk,
    bid: tick.bid,
    totalBid: tick.totalBid,
    time: Math.floor(timeMs / 1000),
  };
}
