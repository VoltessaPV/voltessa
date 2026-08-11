/**
 * Split out of `cloudiness-envelope.ts` so that file never imports
 * `next/cache` at module scope — same reasoning as `calibration-cache.ts`
 * (`next/cache` can only be resolved inside a real Next.js build/runtime,
 * which would break unit-testing anything that transitively imports it).
 */
import { unstable_cache } from "next/cache";

import { computeHistoricalCloudinessFactorUncached } from "@/lib/forecast/cloudiness-envelope";

/** Same 6-hour cache window as `calibration-cache.ts`'s `getHourOfDayCalibration` — this recomputes a 60-day historical reconstruction, comparable cost, same "not on every Dashboard render" requirement. */
export const getHistoricalCloudinessFactor = unstable_cache(
  computeHistoricalCloudinessFactorUncached,
  ["pv-forecast-historical-cloudiness-factor"],
  { revalidate: 21_600 },
);
