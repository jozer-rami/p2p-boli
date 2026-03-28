export interface PricingConfig {
  minSpread: number;
  maxSpread: number;
  tradeAmountUsdt: number;
}

export interface PricingResult {
  buyPrice: number;
  sellPrice: number;
  spread: number;
  paused: { buy: boolean; sell: boolean; reason?: string };
}
