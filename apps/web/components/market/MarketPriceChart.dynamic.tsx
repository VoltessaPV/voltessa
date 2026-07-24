"use client";

import dynamic from "next/dynamic";

/**
 * Chart Loading Optimization milestone. `next/dynamic`'s `ssr: false` may
 * only be called from a Client Component (`app/(platform)/market/
 * page.tsx` is a Server Component) — this file exists solely to hold that
 * call. `MarketPriceChart.tsx` itself (and its real `recharts` dependency)
 * is unchanged; this only defers *loading* it off the page's initial
 * render/hydration path and onto its own chunk, downloaded after the rest
 * of Market is already interactive. Pair with a `<Suspense>` boundary at
 * the call site for the loading fallback — see `ChartSkeleton`.
 */
export const DynamicMarketPriceChart = dynamic(
  () => import("./MarketPriceChart").then((mod) => mod.MarketPriceChart),
  { ssr: false },
);
