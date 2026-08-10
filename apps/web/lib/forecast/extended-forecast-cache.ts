/**
 * Cached, multi-week/month-horizon forecast wrapper — split out of
 * `pv-forecast-engine.ts` so that file (and `generatePvForecastCore`
 * specifically) never imports `next/cache` at module scope. `next/cache`
 * can only be resolved inside a real Next.js build/runtime, which blocked
 * unit-testing `generatePvForecastCore` directly (a Playwright test
 * importing anything from a file with this import at the top fails with
 * "Cannot find module 'next/cache'") — see
 * `e2e/forecast-generation-time-invariance.spec.ts`. No behavior change:
 * every export here is unchanged, just relocated. Confirmed unused
 * anywhere else in the codebase (a leftover from before the Dashboard
 * Forecast Architecture Correction milestone moved forecast generation
 * off the Dashboard's own render path) - kept, not deleted, since removing
 * genuinely dead code wasn't part of this task.
 */
import { unstable_cache } from "next/cache";

import { generatePvForecast } from "@/lib/forecast/pv-forecast-engine";
import type { PvForecastResult } from "@/lib/forecast/types";

/** Rounds down to the current hour (UTC) — the cache-key granularity for `getExtendedPvForecast` below, so every request within the same hour reuses one computation instead of each one re-running the full multi-day forecast. */
function roundDownToHour(date: Date): Date {
  const ms = 60 * 60 * 1000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

async function computeExtendedPvForecastUncached(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  nowHourIso: string;
  horizonDays: number;
}): Promise<PvForecastResult> {
  return generatePvForecast({
    plantId: params.plantId,
    organizationId: params.organizationId,
    latitude: params.latitude,
    longitude: params.longitude,
    capacityKw: params.capacityKw,
    now: new Date(params.nowHourIso),
    horizonHours: params.horizonDays * 24,
  });
}

const getExtendedPvForecastCached = unstable_cache(computeExtendedPvForecastUncached, ["pv-forecast-extended"], {
  revalidate: 3600,
});

/**
 * `unstable_cache`'s underlying cache handler round-trips its return value
 * through JSON on a cache HIT (the value that comes back from Next's cache
 * store, as opposed to a live/cold call, which returns the exact in-memory
 * object `computeExtendedPvForecastUncached` constructed) — which silently
 * turns every `Date` field into a plain ISO string, since `JSON.stringify`
 * has no `Date` representation and `JSON.parse` never reconstructs one.
 * `PvForecastResult`'s type still declares these as `Date` (correct for a
 * cache MISS), so any caller trusting that type and calling
 * `.timestamp.getTime()` crashes the instant a cache HIT hands back a
 * string instead — this is exactly the production incident this function
 * exists to prevent. Every `Date`-typed field is re-hydrated here,
 * unconditionally, so every caller gets a real `Date` instance regardless
 * of whether the value came from cache.
 */
function reviveDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function reviveForecastResult(result: PvForecastResult): PvForecastResult {
  return {
    ...result,
    generatedAt: reviveDate(result.generatedAt),
    intervals: result.intervals.map((interval) => ({ ...interval, timestamp: reviveDate(interval.timestamp) })),
    observedToday: result.observedToday.map((point) => ({ ...point, timestamp: reviveDate(point.timestamp) })),
  };
}

/**
 * Cached, multi-week/month-horizon forecast (Live Energy Forecast
 * Integration milestone) — used only for the Weekly/Monthly forecast
 * summary stats and the Week/Month chart's future-portion overlay, never
 * for Today's near-term chart (that stays on the always-fresh, uncached
 * `generatePvForecast`, since "remaining today" genuinely needs precise,
 * current "now"). Cached for 1 hour per plant (`nowHourIso` rounds down to
 * the current hour so repeated calls within that hour hit the same key) —
 * a multi-week forecast has no reason to be recomputed on every Dashboard
 * render, per this milestone's explicit performance requirement.
 */
export async function getExtendedPvForecast(params: {
  plantId: string;
  organizationId: string;
  latitude: number;
  longitude: number;
  capacityKw: number;
  nowHourIso: string;
  horizonDays: number;
}): Promise<PvForecastResult> {
  const result = await getExtendedPvForecastCached(params);
  return reviveForecastResult(result);
}

export { roundDownToHour };
