export interface PricingConfig {
  minSpread: number;
  maxSpread: number;
  tradeAmountUsdt: number;
  /** Max allowed net exposure before pausing the hot side (0 = disabled) */
  imbalanceThresholdUsdt: number;
}

export interface PricingResult {
  buyPrice: number;
  sellPrice: number;
  spread: number;
  paused: { buy: boolean; sell: boolean; reason?: string };
}
