"use client";

import dynamic from "next/dynamic";

/**
 * Same code-splitting pattern as `MarketPriceChart.dynamic.tsx` - defers
 * loading `recharts`/`ChartFrame` off the page's initial render/hydration
 * path. Pair with a `<Suspense>` boundary and `ChartSkeleton` at the call
 * site.
 */
export const DynamicBatterySocChart = dynamic(
  () => import("./BatterySocChart").then((mod) => mod.BatterySocChart),
  { ssr: false },
);
