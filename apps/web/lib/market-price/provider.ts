/**
 * Market Price Provider — interface only.
 *
 * This module establishes the abstraction the Decision Engine
 * (`lib/automation/export-decision.ts`) and Dashboard will eventually read
 * current market prices through. No real market integration (ENTSO-E or
 * otherwise) is implemented here: no HTTP requests, no API keys, no
 * scheduling. `mockMarketPriceProvider` returns a fixed value so the rest
 * of the automation architecture has something real to build against.
 *
 * Implementing a real provider (e.g. ENTSO-E day-ahead prices) is explicit
 * future work, not done here — see `docs/BACKLOG.md` / `docs/ROADMAP.md`.
 */

export type MarketPrice = {
  price: number;
  currency: "EUR";
  unit: "MWh";
  timestamp: Date;
};

export type MarketPriceProvider = {
  getCurrentMarketPrice: () => Promise<MarketPrice>;
};

/**
 * Temporary mock provider. Returns a fixed price so callers can be wired
 * up and tested before a real market data source exists. Not used by
 * anything automatically — nothing in this milestone calls it.
 */
export const mockMarketPriceProvider: MarketPriceProvider = {
  async getCurrentMarketPrice(): Promise<MarketPrice> {
    return {
      price: 20,
      currency: "EUR",
      unit: "MWh",
      timestamp: new Date(),
    };
  },
};
