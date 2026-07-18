/**
 * Shared, vendor-agnostic constants for the market-price layer. Kept
 * separate so the ENTSO-E provider, the scheduler, and the Market Price
 * Provider all reference the same bidding zone instead of each hardcoding
 * their own copy.
 */

/**
 * ENTSO-E EIC area code for Bulgaria. Verified against the real ENTSO-E
 * Transparency Platform API: a day-ahead price request for this domain
 * code returns `in_Domain.mRID`/`out_Domain.mRID` echoing back
 * "10YCA-BULGARIA-R" with `currency_Unit.name` "EUR" and
 * `price_Measure_Unit.name` "MWH" — this is Bulgaria's real, correct
 * bidding zone for this document type, not an assumed value.
 *
 * The MVP scope (see docs/CLIENT_REQUIREMENTS.md) is a single
 * market/bidding zone; supporting more than one is explicit future work,
 * not done here.
 */
export const DEFAULT_BIDDING_ZONE = "10YCA-BULGARIA-R";

export const MARKET_PRICE_SOURCE_ENTSOE = "ENTSOE";
