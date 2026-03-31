import type { Side } from '../../event-bus.js';

export type RepricingMode = 'conservative' | 'aggressive';

export interface OrderBookFilters {
  minOrderAmount: number;
  verifiedOnly: boolean;
  minCompletionRate: number;
  minOrderCount: number;
  merchantLevels: string[];
}

export interface RepricingConfig {
  mode: RepricingMode;
  targetPosition: number;
  antiOscillationThreshold: number;
  minSpread: number;
  maxSpread: number;
  filters: OrderBookFilters;
  selfUserId: string;
}

export interface RepricingResult {
  buyPrice: number;
  sellPrice: number;
  spread: number;
  position: { buy: number; sell: number };
  filteredCompetitors: { buy: number; sell: number };
  action: 'reprice' | 'hold' | 'pause';
  mode: RepricingMode;
  reason: string;
  phases: PhaseTrace[];
  excludedAggressive: Array<{ side: Side; nickName: string; price: number; gap: number }>;
}

export interface PhaseTrace {
  phase: number;
  name: string;
  result: string;
  durationMs: number;
}

export interface CurrentAdPrices {
  buy: number | null;
  sell: number | null;
}

export const DEFAULT_FILTERS: OrderBookFilters = {
  minOrderAmount: 100,
  verifiedOnly: true,
  minCompletionRate: 80,
  minOrderCount: 10,
  merchantLevels: ['GA', 'VA'],
};

export const MODE_PRESETS: Record<RepricingMode, { targetPosition: number; antiOscillationThreshold: number }> = {
  conservative: { targetPosition: 3, antiOscillationThreshold: 0.003 },
  aggressive: { targetPosition: 1, antiOscillationThreshold: 0.001 },
};
