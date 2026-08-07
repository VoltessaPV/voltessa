"use server";

import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import { requirePlatformAdmin } from "@/lib/auth/session";
import type { BatteryConfig } from "@/lib/digital-twin/battery-dispatch";
import { replay, type ReplayOutcome } from "@/lib/digital-twin/replay-engine";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";

const BULGARIA_TIMEZONE = "Europe/Sofia";

/**
 * ENTSO-E Price Visualization milestone. A day-ahead price view, separate
 * from the Digital Twin's own historical backtest above - this looks
 * forward (Today/Tomorrow/Next 3/7 days), that looks backward (Previous
 * day/week/month). Reuses the same `dbMarketPriceProvider` every other
 * price consumer in the app goes through (never a second ENTSO-E client)
 * and, for the optimizer overlay, the same `replay`/Battery Dispatch Engine
 * the Digital Twin backtest already uses - no second dispatch calculation.
 */
export type EntsoeHorizon = "today" | "tomorrow" | "next-3-days" | "next-7-days";

const HORIZON_DAYS: Record<EntsoeHorizon, number> = {
  today: 1,
  tomorrow: 1,
  "next-3-days": 3,
  "next-7-days": 7,
};

/**
 * Advances a day boundary forward `days` calendar days, one day at a time
 * via `localDayBoundsUtc`'s own "next day" resolution - the same DST-safe
 * technique that function already documents, rather than a fixed
 * `days * 24h` offset (unsafe across a DST transition - see its doc
 * comment).
 */
function advanceCalendarDays(dayBoundary: Date, days: number, timeZone: string): Date {
  let boundary = dayBoundary;
  for (let i = 0; i < days; i += 1) {
    boundary = localDayBoundsUtc(boundary, timeZone).end;
  }
  return boundary;
}

function resolveHorizonRange(horizon: EntsoeHorizon, timeZone: string): { start: Date; end: Date } {
  const todayBounds = localDayBoundsUtc(new Date(), timeZone);
  const start = horizon === "tomorrow" ? todayBounds.end : todayBounds.start;
  const end = advanceCalendarDays(start, HORIZON_DAYS[horizon], timeZone);
  return { start, end };
}

export type EntsoeDecision = {
  time: number;
  action: "charge" | "discharge" | "idle";
};

export type EntsoePriceOverviewResult =
  | {
      ok: true;
      rangeStart: Date;
      rangeEnd: Date;
      series: MarketPricePoint[];
      /**
       * The real Battery Dispatch Engine's own decisions over whatever
       * portion of the horizon already has real telemetry - `replay` over a
       * still-future range (no forecast exists in this codebase) simply
       * returns no intervals, which naturally yields no decisions here.
       * Never fabricated, never a placeholder guess. Empty when `battery`
       * is not supplied.
       */
      decisions: EntsoeDecision[];
    }
  | { ok: false; error: string };

/** Minimum charge/discharge, in kWh, before a bucket counts as "charge"/"discharge" rather than "idle" - filters out float noise, not a real threshold. */
const ACTIVITY_THRESHOLD_KWH = 0.01;
const PRICE_BUCKET_MS = 15 * 60 * 1000;

/**
 * `replay`'s dispatch intervals are native resolution (5-minute); the
 * ENTSO-E price series is always 15-minute. Bucketing to the price grid
 * here (server-side, once) is what lets the chart overlay decisions onto
 * the price line by exact timestamp match, the same safe join
 * `computeExportRevenue` already relies on elsewhere - never a per-render
 * client-side resample. A bucket is "charge"/"discharge" if any native
 * sub-interval charged/discharged (charge takes priority - a bucket never
 * charges and discharges beyond float noise in practice), "idle" only if
 * at least one real sub-interval exists with no activity.
 */
function bucketDecisionsToPriceGrid(intervals: ReplayOutcome["intervals"]): EntsoeDecision[] {
  const buckets = new Map<number, { hasData: boolean; chargeKwh: number; dischargeKwh: number }>();

  for (const interval of intervals) {
    if (interval.chargeKwh === null || interval.dischargeKwh === null) {
      continue;
    }
    const bucketStart = Math.floor(interval.intervalStart.getTime() / PRICE_BUCKET_MS) * PRICE_BUCKET_MS;
    const existing = buckets.get(bucketStart) ?? { hasData: false, chargeKwh: 0, dischargeKwh: 0 };
    buckets.set(bucketStart, {
      hasData: true,
      chargeKwh: existing.chargeKwh + interval.chargeKwh,
      dischargeKwh: existing.dischargeKwh + interval.dischargeKwh,
    });
  }

  return [...buckets.entries()]
    .filter(([, v]) => v.hasData)
    .sort(([a], [b]) => a - b)
    .map(([time, v]) => ({
      time,
      action: v.chargeKwh > ACTIVITY_THRESHOLD_KWH ? "charge" : v.dischargeKwh > ACTIVITY_THRESHOLD_KWH ? "discharge" : "idle",
    }));
}

export async function getEntsoePriceOverview(
  plantId: string,
  horizon: EntsoeHorizon,
  battery: BatteryConfig | null,
): Promise<EntsoePriceOverviewResult> {
  await requirePlatformAdmin();

  try {
    const { start, end } = resolveHorizonRange(horizon, BULGARIA_TIMEZONE);

    const priceResult = await dbMarketPriceProvider.getPricesInRange({ start, end });
    const series: MarketPricePoint[] = priceResult.available
      ? priceResult.prices.map((row) => ({ timestamp: row.timestamp, price: row.price, exportEnabled: false }))
      : [];

    const decisions: EntsoeDecision[] = battery
      ? bucketDecisionsToPriceGrid((await replay({ plantId, start, end, scenario: { batteryScenario: battery } })).intervals)
      : [];

    return { ok: true, rangeStart: start, rangeEnd: end, series, decisions };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to load ENTSO-E price overview" };
  }
}
