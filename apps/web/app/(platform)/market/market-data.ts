/**
 * Market page data orchestration — reads real ENTSO-E day-ahead prices
 * through the Market Price Provider (`lib/market-price/provider.ts`) only;
 * nothing here calls ENTSO-E directly or bypasses the provider. Every
 * price shown on the Market page comes from this module.
 *
 * The one deliberately-not-real input is illustrative export volume
 * (`illustrative-production.ts`) — there is no FusionSolar/Huawei
 * production or export-state data wired into this page yet (explicit
 * future work, see the module doc comment there). Every function below
 * that touches revenue is built so that swapping the illustrative curve
 * for a real per-plant production series later is a one-line change: it
 * always takes a `getProductionMw(timestamp)` shaped input rather than
 * assuming a fixed curve inline.
 */

import {
  resolveExportThreshold,
  type ExportThresholdConfig,
} from "@/lib/automation/export-threshold-config";
import { DEFAULT_RESOLUTION_MINUTES } from "@/lib/market-price/constants";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import {
  ENTSOE_MARKET_TIMEZONE,
  formatDateInZone,
  localDayBoundsUtc,
} from "@/lib/market-price/timezone";

import { estimateIllustrativeProductionMw } from "./illustrative-production";

const INTERVAL_HOURS_FALLBACK = DEFAULT_RESOLUTION_MINUTES / 60;

export type MarketPricePoint = {
  timestamp: Date;
  /** `null` only for a genuinely missing interval — never fabricated. */
  price: number | null;
  exportPowerMw: number;
  exportEnabled: boolean;
};

export type MarketSummaryData = {
  currentPrice: {
    value: number;
    currency: string;
    intervalLabel: string;
    deltaVsPrevious: number;
  } | null;
  nextInterval: {
    value: number;
    intervalLabel: string;
    direction: "up" | "down" | "flat";
  } | null;
  lowestToday: { value: number; intervalLabel: string };
  highestToday: { value: number; intervalLabel: string };
  marketStatus: {
    country: string;
    source: string;
    healthy: boolean;
    lastUpdateLabel: string | null;
  };
};

export type RevenueSummaryData = {
  totalRevenue: number;
  currency: string;
  exportedEnergyMwh: number;
  averageSellingPrice: number;
  revenuePerExportedMwh: number;
  sparkline: number[];
};

export type TimelineEvent = {
  timeLabel: string;
  type: "export_enabled" | "export_disabled";
  reason: string;
  isPast: boolean;
  isNext: boolean;
};

export type TimelineSummary = {
  currentStateLabel: string;
  currentStateSinceLabel: string;
  nextActionLabel: string | null;
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

export type MarketToolbarState = {
  selectedDate: string;
  isToday: boolean;
  prevDateParam: string;
  nextDateParam: string;
};

export type MarketPageResult =
  | ({
      dataAvailable: false;
      threshold: ExportThresholdConfig;
    } & MarketToolbarState)
  | ({
      dataAvailable: true;
      threshold: ExportThresholdConfig;
      series: MarketPricePoint[];
      isPartialImport: boolean;
      summary: MarketSummaryData;
      revenue: RevenueSummaryData;
      timeline: TimelineEvent[];
      timelineSummary: TimelineSummary;
      distribution: DistributionBucket[];
      insights: MarketInsight[];
    } & MarketToolbarState);

function shiftDateString(dateStr: string, deltaDays: number): string {
  const parts = dateStr.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);

  return date.toISOString().slice(0, 10);
}

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function sofiaTimeLabel(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSeries(
  prices: Array<{ timestamp: Date; price: number }>,
  periodStart: Date,
  periodEnd: Date,
  resolutionMinutes: number,
  threshold: ExportThresholdConfig,
): MarketPricePoint[] {
  const byTime = new Map(prices.map((p) => [p.timestamp.getTime(), p.price]));
  const points: MarketPricePoint[] = [];

  for (
    let t = periodStart.getTime();
    t < periodEnd.getTime();
    t += resolutionMinutes * 60 * 1000
  ) {
    const timestamp = new Date(t);
    const price = byTime.get(t) ?? null;
    const exportPowerMw = estimateIllustrativeProductionMw(
      timestamp,
      ENTSOE_MARKET_TIMEZONE,
    );

    points.push({
      timestamp,
      price,
      exportPowerMw,
      exportEnabled: price !== null && price >= threshold.minimumExportPrice,
    });
  }

  return points;
}

function buildTimeline(
  series: MarketPricePoint[],
  now: Date,
  isToday: boolean,
): { events: TimelineEvent[]; summary: TimelineSummary } {
  const knownPoints = series.filter((point) => point.price !== null);
  const events: TimelineEvent[] = [];
  let previousEnabled: boolean | null = null;
  let nextEventIndex = -1;

  knownPoints.forEach((point) => {
    if (previousEnabled !== null && point.exportEnabled !== previousEnabled) {
      const isPast = isToday ? point.timestamp.getTime() <= now.getTime() : true;

      if (!isPast && nextEventIndex === -1) {
        nextEventIndex = events.length;
      }

      events.push({
        timeLabel: sofiaTimeLabel(point.timestamp),
        type: point.exportEnabled ? "export_enabled" : "export_disabled",
        reason: point.exportEnabled
          ? "Price above threshold"
          : "Price below threshold",
        isPast,
        isNext: false,
      });
    }

    previousEnabled = point.exportEnabled;
  });

  if (nextEventIndex >= 0) {
    events[nextEventIndex] = { ...events[nextEventIndex]!, isNext: true };
  }

  let currentStateLabel = "No data";
  let currentStateSinceLabel = "";

  if (isToday) {
    const currentPoint = [...knownPoints]
      .reverse()
      .find((point) => point.timestamp.getTime() <= now.getTime());

    if (currentPoint) {
      currentStateLabel = currentPoint.exportEnabled
        ? "Export enabled"
        : "Export disabled";

      const lastTransition = [...events]
        .filter((event) => event.isPast)
        .at(-1);

      currentStateSinceLabel = lastTransition
        ? `since ${lastTransition.timeLabel}`
        : "since start of day";
    }
  } else if (knownPoints.length > 0) {
    currentStateLabel = "Historical day";
    currentStateSinceLabel = "no live state for a non-today view";
  }

  const nextEvent = events.find((event) => event.isNext);
  const nextActionLabel = nextEvent
    ? `${nextEvent.type === "export_enabled" ? "Export will be enabled" : "Export will be disabled"} at ${nextEvent.timeLabel}`
    : null;

  return {
    events,
    summary: { currentStateLabel, currentStateSinceLabel, nextActionLabel },
  };
}

function buildDistribution(
  knownPoints: MarketPricePoint[],
): DistributionBucket[] {
  const buckets = [
    { label: "Negative", rangeLabel: "< 0", min: -Infinity, max: 0, colorClass: "bg-red-400" },
    { label: "Low", rangeLabel: "0–75", min: 0, max: 75, colorClass: "bg-emerald-400" },
    { label: "Mid", rangeLabel: "75–150", min: 75, max: 150, colorClass: "bg-blue-400" },
    { label: "High", rangeLabel: "150–225", min: 150, max: 225, colorClass: "bg-amber-400" },
    { label: "Peak", rangeLabel: "> 225", min: 225, max: Infinity, colorClass: "bg-red-400" },
  ];

  return buckets
    .map((bucket) => {
      const count = knownPoints.filter(
        (point) =>
          point.price !== null &&
          point.price >= bucket.min &&
          point.price < bucket.max,
      ).length;

      return {
        label: bucket.label,
        rangeLabel: bucket.rangeLabel,
        percentage:
          knownPoints.length > 0
            ? Math.round((count / knownPoints.length) * 1000) / 10
            : 0,
        colorClass: bucket.colorClass,
      };
    })
    .filter((bucket) => bucket.percentage > 0);
}

function buildRevenue(knownPoints: MarketPricePoint[]): RevenueSummaryData {
  const intervalHours = INTERVAL_HOURS_FALLBACK;

  const exportingPoints = knownPoints.filter((point) => point.exportEnabled);

  let exportedEnergyMwh = 0;
  let totalRevenue = 0;
  let cumulativeRevenue = 0;
  const sparkline: number[] = [];

  for (const point of knownPoints) {
    const producedMwh = point.exportPowerMw * intervalHours;
    const isExporting = point.exportEnabled;

    if (isExporting) {
      exportedEnergyMwh += producedMwh;
      totalRevenue += producedMwh * (point.price as number);
    }

    cumulativeRevenue += isExporting ? producedMwh * (point.price as number) : 0;
    sparkline.push(Math.round(cumulativeRevenue));
  }

  const averageSellingPrice =
    exportingPoints.length > 0
      ? exportingPoints.reduce((sum, point) => sum + (point.price as number), 0) /
        exportingPoints.length
      : 0;

  const revenuePerExportedMwh =
    exportedEnergyMwh > 0 ? totalRevenue / exportedEnergyMwh : 0;

  return {
    totalRevenue: Math.round(totalRevenue),
    currency: "EUR",
    exportedEnergyMwh: Math.round(exportedEnergyMwh * 100) / 100,
    averageSellingPrice: Math.round(averageSellingPrice * 100) / 100,
    revenuePerExportedMwh: Math.round(revenuePerExportedMwh * 100) / 100,
    sparkline,
  };
}

function buildInsights(knownPoints: MarketPricePoint[]): MarketInsight[] {
  const withPrice = knownPoints.filter(
    (point): point is MarketPricePoint & { price: number } =>
      point.price !== null,
  );

  const highest = withPrice.reduce((max, point) =>
    point.price > max.price ? point : max,
  );
  const lowest = withPrice.reduce((min, point) =>
    point.price < min.price ? point : min,
  );
  const spread = Math.round((highest.price - lowest.price) * 100) / 100;

  const mean =
    withPrice.reduce((sum, point) => sum + point.price, 0) / withPrice.length;
  const variance =
    withPrice.reduce((sum, point) => sum + (point.price - mean) ** 2, 0) /
    withPrice.length;
  const stdDev = Math.sqrt(variance);
  const volatility = stdDev > 45 ? "High" : stdDev > 25 ? "Medium" : "Low";

  return [
    {
      text: `Highest price: ${sofiaTimeLabel(highest.timestamp)} (${highest.price} EUR/MWh)`,
      tone: "warning",
    },
    {
      text: `Lowest price: ${sofiaTimeLabel(lowest.timestamp)} (${lowest.price} EUR/MWh)`,
      tone: "positive",
    },
    { text: `Market volatility: ${volatility}`, tone: "neutral" },
    { text: `Spread: ${spread} EUR/MWh`, tone: "neutral" },
  ];
}

export async function getMarketPageData(params: {
  selectedDateParam: string | undefined;
  automationSettings: {
    minimumExportPrice: { toString(): string };
    currency: string;
  } | null;
}): Promise<MarketPageResult> {
  const todayDateStr = formatDateInZone(new Date(), ENTSOE_MARKET_TIMEZONE);
  const selectedDate =
    params.selectedDateParam && isValidDateString(params.selectedDateParam)
      ? params.selectedDateParam
      : todayDateStr;
  const isToday = selectedDate === todayDateStr;
  const referenceInstant = new Date(`${selectedDate}T12:00:00Z`);

  const threshold = resolveExportThreshold(params.automationSettings);

  const toolbarState: MarketToolbarState = {
    selectedDate,
    isToday,
    prevDateParam: shiftDateString(selectedDate, -1),
    nextDateParam: shiftDateString(selectedDate, 1),
  };

  const dayAheadResult = await dbMarketPriceProvider.getDayAheadPrices({
    referenceDate: referenceInstant,
  });

  if (!dayAheadResult.available) {
    return { dataAvailable: false, threshold, ...toolbarState };
  }

  const importStatus = await dbMarketPriceProvider.getLatestImportStatus();
  const resolutionMinutes = importStatus.available
    ? importStatus.resolutionMinutes
    : DEFAULT_RESOLUTION_MINUTES;

  const { start: periodStart, end: periodEnd } = localDayBoundsUtc(
    referenceInstant,
    ENTSOE_MARKET_TIMEZONE,
  );

  const series = buildSeries(
    dayAheadResult.prices,
    periodStart,
    periodEnd,
    resolutionMinutes,
    threshold,
  );

  const knownPoints = series.filter((point) => point.price !== null);
  const now = new Date();

  let currentPrice: MarketSummaryData["currentPrice"] = null;
  let nextInterval: MarketSummaryData["nextInterval"] = null;

  if (isToday) {
    const currentResult = await dbMarketPriceProvider.getCurrentPrice();

    if (currentResult.available) {
      const currentIndex = knownPoints.findIndex(
        (point) =>
          point.timestamp.getTime() === currentResult.price.timestamp.getTime(),
      );
      const previousPoint =
        currentIndex > 0 ? knownPoints[currentIndex - 1] : undefined;
      const nextPoint =
        currentIndex >= 0 && currentIndex < knownPoints.length - 1
          ? knownPoints[currentIndex + 1]
          : undefined;

      currentPrice = {
        value: currentResult.price.price,
        currency: currentResult.price.currency,
        intervalLabel: sofiaTimeLabel(currentResult.price.timestamp),
        deltaVsPrevious: previousPoint
          ? Math.round(
              (currentResult.price.price - (previousPoint.price as number)) *
                100,
            ) / 100
          : 0,
      };

      if (nextPoint && nextPoint.price !== null) {
        const direction =
          nextPoint.price > currentResult.price.price
            ? "up"
            : nextPoint.price < currentResult.price.price
              ? "down"
              : "flat";

        nextInterval = {
          value: nextPoint.price,
          intervalLabel: sofiaTimeLabel(nextPoint.timestamp),
          direction,
        };
      }
    }
  }

  const lowestKnown = knownPoints.reduce((min, point) =>
    (point.price as number) < (min.price as number) ? point : min,
  );
  const highestKnown = knownPoints.reduce((max, point) =>
    (point.price as number) > (max.price as number) ? point : max,
  );

  const summary: MarketSummaryData = {
    currentPrice,
    nextInterval,
    lowestToday: {
      value: lowestKnown.price as number,
      intervalLabel: sofiaTimeLabel(lowestKnown.timestamp),
    },
    highestToday: {
      value: highestKnown.price as number,
      intervalLabel: sofiaTimeLabel(highestKnown.timestamp),
    },
    marketStatus: {
      country: "Bulgaria",
      source: "ENTSO-E",
      healthy: importStatus.available ? !importStatus.isPartial : false,
      lastUpdateLabel:
        isToday && importStatus.available
          ? importStatus.importedAt.toLocaleString()
          : null,
    },
  };

  const { events: timeline, summary: timelineSummary } = buildTimeline(
    series,
    now,
    isToday,
  );

  return {
    dataAvailable: true,
    threshold,
    series,
    isPartialImport: isToday && importStatus.available && importStatus.isPartial,
    summary,
    revenue: buildRevenue(knownPoints),
    timeline,
    timelineSummary,
    distribution: buildDistribution(knownPoints),
    insights: buildInsights(knownPoints),
    ...toolbarState,
  };
}
