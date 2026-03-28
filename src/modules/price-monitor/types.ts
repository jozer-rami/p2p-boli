export interface CriptoYaPrices {
  [exchange: string]: {
    ask: number;
    totalAsk: number;
    bid: number;
    totalBid: number;
    time: number;
  };
}

export interface PriceSnapshot {
  price: number;
  timestamp: number;
}
