"use client";

import dynamic from "next/dynamic";

/** Same code-splitting pattern as `MarketPriceChart.dynamic.tsx`/`BatterySocChart.dynamic.tsx` - defers loading `recharts`/`ChartFrame` off the page's initial render/hydration path. Pair with a `<Suspense>` boundary and `ChartSkeleton` at the call site. */
export const DynamicEntsoePriceChart = dynamic(
  () => import("./EntsoePriceChart").then((mod) => mod.EntsoePriceChart),
  { ssr: false },
);
