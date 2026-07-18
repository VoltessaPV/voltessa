/**
 * Shared, vendor-agnostic constants for the market-price layer. Kept
 * separate so the ENTSO-E provider, the scheduler, and the Market Price
 * Provider all reference the same bidding zone instead of each hardcoding
 * their own copy.
 */

/**
 * ENTSO-E EIC area code for Bulgaria. The MVP scope (see
 * docs/CLIENT_REQUIREMENTS.md) is a single market/bidding zone; supporting
 * more than one is explicit future work, not done here.
 */
export const DEFAULT_BIDDING_ZONE = "10YCA-BULGARIA-R";

export const MARKET_PRICE_SOURCE_ENTSOE = "ENTSOE";
