/**
 * Mock data for the Market page UI-only milestone. Nothing here reads
 * from `lib/market-price/*` or any other real data source, and nothing
 * here is written by it — this is a self-contained, clearly-scoped mock
 * so the layout and components can be built and reviewed before being
 * wired to the real Market Price Provider / Decision Engine in a future
 * milestone. Every shape here mirrors what the real data will look like
 * (see `lib/market-price/provider.ts`'s `MarketPrice` type and
 * `lib/automation/export-threshold-config.ts`) so swapping the source
 * later is a data-plumbing change, not a component redesign.
 */

const MOCK_BIDDING_ZONE = "Bulgaria";
const MOCK_SOURCE = "ENTSO-E";
/**
 * Illustrative only — the real threshold lives in AutomationSettings.
 * Chosen so the synthetic price curve below (which is shaped like a real
 * day-ahead curve, roughly 80-200 EUR/MWh) crosses it a realistic number
 * of times rather than sitting entirely above or below it.
 */
const MOCK_EXPORT_THRESHOLD = 145;
const INTERVAL_MINUTES = 15;
const INTERVALS_PER_DAY = (24 * 60) / INTERVAL_MINUTES;

export type MarketPricePoint = {
  timestamp: Date;
  price: number;
  exportPowerMw: number;
  exportEnabled: boolean;
};

export type MarketSummaryData = {
  currentPrice: {
    value: number;
    currency: string;
    intervalLabel: string;
    deltaVsPrevious: number;
  };
  nextHour: {
    value: number;
    intervalLabel: string;
    direction: "up" | "down" | "flat";
  };
  lowestToday: { value: number; intervalLabel: string };
  highestToday: { value: number; intervalLabel: string };
  marketStatus: {
    country: string;
    source: string;
    lastUpdateLabel: string;
    healthy: boolean;
  };
};

export type RevenueSummaryData = {
  totalRevenue: number;
  currency: string;
  exportedEnergyMwh: number;
  averageSellingPrice: number;
  revenuePerMwh: number;
  sparkline: number[];
};

export type TimelineEvent = {
  timeLabel: string;
  type: "export_enabled" | "export_disabled";
  reason: string;
};

export type DistributionBucket = {
  label: string;
  rangeLabel: string;
  percentage: number;
  colorClass: string;
};

export type MarketInsight = {
  text: string;
  tone: "neutral" | "positive" | "warning";
};

export type MarketPageData = {
  series: MarketPricePoint[];
  summary: MarketSummaryData;
  revenue: RevenueSummaryData;
  timeline: TimelineEvent[];
  distribution: DistributionBucket[];
  insights: MarketInsight[];
};

function sofiaTimeLabel(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Small deterministic PRNG so the mock looks stable across renders instead of flickering on every request. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function at(points: MarketPricePoint[], index: number): MarketPricePoint {
  const point = points[index];

  if (!point) {
    throw new Error("mock market series index out of bounds");
  }

  return point;
}

function buildPriceSeries(dayStart: Date): MarketPricePoint[] {
  const points: MarketPricePoint[] = [];

  for (let i = 0; i < INTERVALS_PER_DAY; i += 1) {
    const timestamp = new Date(
      dayStart.getTime() + i * INTERVAL_MINUTES * 60 * 1000,
    );
    const hour = i / 4;

    // Two evening/morning peaks, a midday solar-driven dip - shaped like a
    // real day-ahead curve rather than a smooth sine (see the real curve
    // captured in docs from the ENTSO-E integration milestone).
    const morningPeak = 55 * Math.exp(-((hour - 8) ** 2) / 6);
    const eveningPeak = 75 * Math.exp(-((hour - 20) ** 2) / 8);
    const middayDip = -40 * Math.exp(-((hour - 13) ** 2) / 10);
    const base = 120 + morningPeak + eveningPeak + middayDip;
    const noise = (seededRandom(i * 12.9898) - 0.5) * 10;
    const price = Math.round((base + noise) * 100) / 100;

    // Solar generation bell curve peaking at midday, zero overnight.
    const daylight = Math.max(0, Math.sin(((hour - 5) / 14) * Math.PI));
    const exportPowerMw = Math.round(daylight * 4.8 * 100) / 100;

    const exportEnabled = price >= MOCK_EXPORT_THRESHOLD;

    points.push({ timestamp, price, exportPowerMw, exportEnabled });
  }

  return points;
}

function buildTimeline(series: MarketPricePoint[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let previousEnabled: boolean | null = null;

  for (const point of series) {
    if (previousEnabled !== null && point.exportEnabled !== previousEnabled) {
      events.push({
        timeLabel: sofiaTimeLabel(point.timestamp),
        type: point.exportEnabled ? "export_enabled" : "export_disabled",
        reason: point.exportEnabled
          ? "Price above threshold"
          : "Price below threshold",
      });
    }

    previousEnabled = point.exportEnabled;
  }

  return events;
}

function buildDistribution(series: MarketPricePoint[]): DistributionBucket[] {
  const buckets = [
    { label: "Negative", rangeLabel: "< 0", min: -Infinity, max: 0, colorClass: "bg-red-400" },
    { label: "Low", rangeLabel: "0–75", min: 0, max: 75, colorClass: "bg-emerald-400" },
    { label: "Mid", rangeLabel: "75–150", min: 75, max: 150, colorClass: "bg-blue-400" },
    { label: "High", rangeLabel: "150–225", min: 150, max: 225, colorClass: "bg-amber-400" },
    { label: "Peak", rangeLabel: "> 225", min: 225, max: Infinity, colorClass: "bg-red-400" },
  ];

  return buckets
    .map((bucket) => {
      const count = series.filter(
        (point) => point.price >= bucket.min && point.price < bucket.max,
      ).length;

      return {
        label: bucket.label,
        rangeLabel: bucket.rangeLabel,
        percentage: Math.round((count / series.length) * 1000) / 10,
        colorClass: bucket.colorClass,
      };
    })
    .filter((bucket) => bucket.percentage > 0);
}

function buildRevenue(series: MarketPricePoint[]): RevenueSummaryData {
  const intervalHours = INTERVAL_MINUTES / 60;

  let exportedEnergyMwh = 0;
  let totalProducedMwh = 0;
  let totalRevenue = 0;
  const sparkline: number[] = [];
  let cumulativeRevenue = 0;

  for (const point of series) {
    const producedMwh = point.exportPowerMw * intervalHours;
    totalProducedMwh += producedMwh;

    if (point.exportEnabled) {
      exportedEnergyMwh += producedMwh;
      totalRevenue += producedMwh * point.price;
    }

    cumulativeRevenue += point.exportEnabled ? producedMwh * point.price : 0;
    sparkline.push(Math.round(cumulativeRevenue));
  }

  const averageSellingPrice =
    exportedEnergyMwh > 0 ? totalRevenue / exportedEnergyMwh : 0;
  const revenuePerMwh =
    totalProducedMwh > 0 ? totalRevenue / totalProducedMwh : 0;

  return {
    totalRevenue: Math.round(totalRevenue),
    currency: "EUR",
    exportedEnergyMwh: Math.round(exportedEnergyMwh * 100) / 100,
    averageSellingPrice: Math.round(averageSellingPrice * 100) / 100,
    revenuePerMwh: Math.round(revenuePerMwh * 100) / 100,
    sparkline,
  };
}

function buildInsights(series: MarketPricePoint[]): MarketInsight[] {
  const highest = series.reduce((max, point) =>
    point.price > max.price ? point : max,
  );
  const lowest = series.reduce((min, point) =>
    point.price < min.price ? point : min,
  );
  const spread = Math.round((highest.price - lowest.price) * 100) / 100;

  const mean =
    series.reduce((sum, point) => sum + point.price, 0) / series.length;
  const variance =
    series.reduce((sum, point) => sum + (point.price - mean) ** 2, 0) /
    series.length;
  const stdDev = Math.sqrt(variance);
  const volatility =
    stdDev > 45 ? "High" : stdDev > 25 ? "Medium" : "Low";

  return [
    {
      text: `Highest price expected at ${sofiaTimeLabel(highest.timestamp)} (${highest.price} EUR/MWh)`,
      tone: "warning",
    },
    {
      text: `Lowest price expected at ${sofiaTimeLabel(lowest.timestamp)} (${lowest.price} EUR/MWh)`,
      tone: "positive",
    },
    {
      text: `Market volatility: ${volatility}`,
      tone: "neutral",
    },
    {
      text: `Expected spread: ${spread} EUR/MWh`,
      tone: "neutral",
    },
  ];
}

export function getMockMarketPageData(): MarketPageData {
  const now = new Date();
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const series = buildPriceSeries(dayStart);

  const currentIndex = Math.min(
    Math.floor((now.getTime() - dayStart.getTime()) / (INTERVAL_MINUTES * 60 * 1000)),
    series.length - 1,
  );
  const current = at(series, currentIndex);
  const previous = at(series, Math.max(0, currentIndex - 1));
  const next = at(series, Math.min(series.length - 1, currentIndex + 1));

  const lowest = series.reduce((min, point) =>
    point.price < min.price ? point : min,
  );
  const highest = series.reduce((max, point) =>
    point.price > max.price ? point : max,
  );

  const direction =
    next.price > current.price
      ? "up"
      : next.price < current.price
        ? "down"
        : "flat";

  const summary: MarketSummaryData = {
    currentPrice: {
      value: current.price,
      currency: "EUR",
      intervalLabel: sofiaTimeLabel(current.timestamp),
      deltaVsPrevious: Math.round((current.price - previous.price) * 100) / 100,
    },
    nextHour: {
      value: next.price,
      intervalLabel: sofiaTimeLabel(next.timestamp),
      direction,
    },
    lowestToday: {
      value: lowest.price,
      intervalLabel: sofiaTimeLabel(lowest.timestamp),
    },
    highestToday: {
      value: highest.price,
      intervalLabel: sofiaTimeLabel(highest.timestamp),
    },
    marketStatus: {
      country: MOCK_BIDDING_ZONE,
      source: MOCK_SOURCE,
      lastUpdateLabel: sofiaTimeLabel(current.timestamp),
      healthy: true,
    },
  };

  return {
    series,
    summary,
    revenue: buildRevenue(series),
    timeline: buildTimeline(series),
    distribution: buildDistribution(series),
    insights: buildInsights(series),
  };
}
