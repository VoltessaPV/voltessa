/**
 * Split out of `analog-days.ts` so that file never imports `next/cache` at
 * module scope — `next/cache` can only be resolved inside a real Next.js
 * build/runtime, which blocked unit-testing `detectProductionCollapse`/
 * `computeAnalogDaysUncached` directly (a Playwright test importing
 * anything from a file with this import at the top fails with "Cannot
 * find module 'next/cache'") — see `e2e/forecast-analog-quality.spec.ts`.
 * No behavior change: same wrapper, same cache key, same revalidate
 * window, just relocated.
 */
import { unstable_cache } from "next/cache";

import { computeAnalogDaysUncached } from "@/lib/forecast/analog-days";

/** Cached for 6 hours per plant+target-day+weather-bucket — see `calibration.ts`'s identical rationale. */
export const getAnalogDays = unstable_cache(computeAnalogDaysUncached, ["pv-forecast-analog-days"], {
  revalidate: 21_600,
});
