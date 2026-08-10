/**
 * Split out of `calibration.ts` so that file never imports `next/cache` at
 * module scope — `next/cache` can only be resolved inside a real Next.js
 * build/runtime, which blocked unit-testing `pv-forecast-core.ts`'s
 * `generatePvForecastCore` directly (it imports `applyHourOfDayCalibration`
 * from `calibration.ts`; a Playwright test importing anything from a file
 * with this import at the top fails with "Cannot find module
 * 'next/cache'") — see `e2e/forecast-generation-time-invariance.spec.ts`.
 * No behavior change: same wrapper, same cache key, same revalidate
 * window, just relocated.
 */
import { unstable_cache } from "next/cache";

import { computeHourOfDayCalibrationUncached } from "@/lib/forecast/calibration";

/**
 * Cached for 6 hours per plant+day — this recomputes a 60-day historical
 * reconstruction plus an archive-weather fetch, real cost that must not run
 * on every Dashboard render (same pattern `lib/admin/platform-health.ts`'s
 * `getDataIntegrityReport` already established for a comparably expensive
 * scan). `asOf` is passed in as a `YYYY-MM-DD` cache-key component (backtest
 * callers pass distinct historical dates so each walk-forward day gets its
 * own correctly-scoped, non-leaking cache entry instead of colliding on
 * "today").
 */
export const getHourOfDayCalibration = unstable_cache(
  computeHourOfDayCalibrationUncached,
  ["pv-forecast-hour-of-day-calibration"],
  { revalidate: 21_600 },
);
