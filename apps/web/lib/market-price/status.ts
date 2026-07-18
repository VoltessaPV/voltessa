/**
 * Shared "is this price fresh?" presentation logic, used by both the
 * Settings page and the Dashboard so there is exactly one definition of
 * "stale" rather than two copies drifting apart.
 */

import type { MarketPriceResult } from "@/lib/market-price/provider";

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export type MarketPriceStatus = {
  label: "Live" | "Stale" | "Unavailable";
  detail: string;
  colorClass: string;
};

/**
 * Reflects only what the Market Price Provider actually returned — never
 * infers or fabricates a price when it is unavailable.
 */
export function getMarketPriceStatus(
  result: MarketPriceResult,
): MarketPriceStatus {
  if (!result.available) {
    return {
      label: "Unavailable",
      detail: result.reason,
      colorClass: "bg-slate-500",
    };
  }

  const ageMs = Date.now() - result.price.timestamp.getTime();
  const isStale = ageMs > STALE_AFTER_MS;

  return {
    label: isStale ? "Stale" : "Live",
    detail: `Last updated ${result.price.timestamp.toLocaleString()}`,
    colorClass: isStale ? "bg-amber-400" : "bg-emerald-400",
  };
}
