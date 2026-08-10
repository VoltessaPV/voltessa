"use client";

import dynamic from "next/dynamic";

/**
 * Forecast Card Visualization milestone — same reasoning as
 * `LiveEnergyChart.dynamic.tsx`: `next/dynamic`'s `ssr: false` may only be
 * called from a Client Component, and `GlidepathCard.tsx` (its caller)
 * stays a Server Component. `ForecastChart.tsx` itself is unchanged by
 * this wrapper; it only defers loading `recharts` off the page's initial
 * render/hydration path.
 */
export const DynamicForecastChart = dynamic(
  () => import("./ForecastChart").then((mod) => mod.ForecastChart),
  { ssr: false },
);
