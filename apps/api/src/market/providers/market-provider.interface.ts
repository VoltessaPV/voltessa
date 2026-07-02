export interface MarketPrice {
  market: string;
  price: number;
  currency: string;
  timestamp: string;
}

export interface MarketProvider {
  getCurrentPrice(): Promise<MarketPrice>;
}