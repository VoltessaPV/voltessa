/**
 * Market page data orchestration — reads real ENTSO-E day-ahead prices
 * through the Market Price Provider (`lib/market-price/provider.ts`) only;
 * nothing here calls ENTSO-E directly or bypasses the provider. Every
 * number shown on the Market page is either a real price or a plain,
 * disclosed statistic computed over real prices — nothing is fabricated.
 *
 * Still no revenue figure computed *here*: revenue requires multiplying a
 * real price by real exported energy (`production-data.ts`'s
 * `settlementEnergySeries`, Mathematical Correctness milestone), and this
 * module deliberately never imports that one (see the module independence
 * note in `production-data.ts`). `page.tsx` composes both into the actual
 * revenue figure — see its `computeExportRevenue`. An earlier version of
 * this module multiplied real prices by an illustrative generation curve
 * to produce a Euro figure; that looked like real money and wasn't,
 * removed entirely rather than caveated. The current revenue figure is
 * real, derived only from real per-interval exported energy × the real
 * price for that same interval — never estimated, never integrated from
 * power.
 */

import {
  getRecentAutomationEvents,
  type AutomationEventType,
} from "@/lib/automation/automation-events";
import {
  isExportRecommended,
  resolveExportThreshold,
  type ExportThresholdConfig,
} from "@/lib/automation/export-threshold-config";
import { DEFAULT_RESOLUTION_MINUTES } from "@/lib/market-price/constants";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import { formatDateInZone, localDayBoundsUtc } from "@/lib/market-price/timezone";

/**
 * The Market page's displayed day is always a full Bulgaria calendar day
 * (00:00–24:00 Europe/Sofia) — not ENTSO-E's own CET/CEST market-day
 * convention (`ENTSOE_MARKET_TIMEZONE`), which is a fetch-boundary detail
 * internal to the importer/`refresh-market-prices.ts`. Using it here (as
 * an earlier version of this module did) made the chart start ~01:00
 * Sofia time with an empty midnight gap, since Sofia is one hour ahead of
 * CET/CEST. `MarketPrice.timestamp` rows are real absolute instants, so
 * windowing the query by Sofia's own local day instead is purely a
 * display-boundary fix — see `lib/market-price/provider.ts`'s
 * `getDayAheadPrices` `timeZone` option.
 */
export const BULGARIA_TIMEZONE = "Europe/Sofia";

export type MarketPricePoint = {
  timestamp: Date;
  /** `null` only for a genuinely missing interval — never fabricated. */
  price: number | null;
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
  };
};

/**
 * A real system event — the automation engine's own `AutomationEvent`
 * table (`lib/automation/automation-events.ts`), never derived from
 * prices. `type` reuses `AutomationEventType` directly rather than a
 * separate, parallel vocabulary, so this can never drift from what the
 * engine actually emits.
 */
export type MarketEventLogEntry = {
  timestamp: Date;
  type: AutomationEventType;
  label: string;
  detail?: string;
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
  /** Overrides the tone-based dot color when set — used only by the Highest/Lowest price insights, to match Price Distribution's High/Low ring colors exactly. */
  dotColorClass?: string;
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
      eventLog: MarketEventLogEntry[];
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

/**
 * Sofia's calendar day starts one hour before the CET/CEST market day it's
 * windowed against (see `BULGARIA_TIMEZONE`'s own doc comment), so a Sofia
 * day whose own CET day hasn't been imported yet still returns exactly one
 * row: the tail hour of the *previous* CET day, landing at Sofia 00:00 for
 * this query. That single row is real data, but it belongs to a different
 * ENTSO-E trading day and isn't enough to render this day's chart — so it
 * must not count as "this day has data" once the day is today or in the
 * past (see `getMarketPageData`'s use of this).
 */
function hasOnlyResidualPreviousDayInterval(
  prices: Array<{ timestamp: Date }>,
  periodStart: Date,
): boolean {
  const residualCutoff = periodStart.getTime() + 60 * 60 * 1000;
  return prices.every((p) => p.timestamp.getTime() < residualCutoff);
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

    points.push({
      timestamp,
      price,
      exportEnabled: price !== null && isExportRecommended(price, threshold),
    });
  }

  return points;
}

/** Exported so scripts/create-landing-snapshot.ts can reuse this exact aggregation instead of duplicating it — no behavior change for the existing internal caller below. */
/**
 * Price Distribution's High/Low ring colors — named here (not just inline
 * in `buckets` below) so `buildInsights`'s Highest/Lowest price entries can
 * reuse the exact same values instead of a second, easily-drifting literal.
 */
const DISTRIBUTION_HIGH_COLOR_CLASS = "bg-emerald-400";
const DISTRIBUTION_LOW_COLOR_CLASS = "bg-amber-400";

export function buildDistribution(
  knownPoints: MarketPricePoint[],
): DistributionBucket[] {
  // Three bands, High-to-Low (Market Dashboard UX Polish milestone) —
  // deliberately not five: "Negative" collapses into Low (< 75) and "Peak"
  // collapses into High (> 150), since the milestone's spec names exactly
  // these three bands and colors (High=green, Mid=blue, Low=amber),
  // ordered High first.
  const buckets = [
    { label: "High", rangeLabel: "> 150", min: 150, max: Infinity, colorClass: DISTRIBUTION_HIGH_COLOR_CLASS },
    { label: "Mid", rangeLabel: "75–150", min: 75, max: 150, colorClass: "bg-blue-400" },
    { label: "Low", rangeLabel: "< 75", min: -Infinity, max: 75, colorClass: DISTRIBUTION_LOW_COLOR_CLASS },
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

/**
 * Plain, factual observations over the real price series — never
 * speculative ("expected", "predicted"). Each one is a statistic anyone
 * could recompute from the same series.
 *
 * Exported so scripts/create-landing-snapshot.ts can reuse this exact
 * aggregation instead of duplicating it — no behavior change for the
 * existing internal caller below.
 */
export function buildInsights(
  knownPoints: MarketPricePoint[],
  resolutionMinutes: number,
): MarketInsight[] {
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
  const averagePrice = Math.round(mean * 100) / 100;

  const intervalHours = resolutionMinutes / 60;
  const aboveThresholdCount = knownPoints.filter(
    (point) => point.exportEnabled,
  ).length;
  const hoursAboveThreshold =
    Math.round(aboveThresholdCount * intervalHours * 10) / 10;
  const hoursBelowThreshold =
    Math.round((knownPoints.length - aboveThresholdCount) * intervalHours * 10) /
    10;

  return [
    {
      text: `Highest price today: ${highest.price} EUR/MWh at ${sofiaTimeLabel(highest.timestamp)}`,
      tone: "warning",
      dotColorClass: DISTRIBUTION_HIGH_COLOR_CLASS,
    },
    {
      text: `Lowest price today: ${lowest.price} EUR/MWh at ${sofiaTimeLabel(lowest.timestamp)}`,
      tone: "positive",
      dotColorClass: DISTRIBUTION_LOW_COLOR_CLASS,
    },
    { text: `Price spread: ${spread} EUR/MWh`, tone: "neutral" },
    { text: `Average price: ${averagePrice} EUR/MWh`, tone: "neutral" },
    { text: `Hours above threshold: ${hoursAboveThreshold} h`, tone: "positive" },
    { text: `Hours below threshold: ${hoursBelowThreshold} h`, tone: "neutral" },
  ];
}

export async function getMarketPageData(params: {
  /** Null for a Trader Workspace with no client selected - the platform-wide price series is still computed, only the organization-scoped event log is skipped. */
  organizationId: string | null;
  selectedDateParam: string | undefined;
  automationSettings: {
    minimumExportPrice: { toString(): string };
    currency: string;
  } | null;
}): Promise<MarketPageResult> {
  const todayDateStr = formatDateInZone(new Date(), BULGARIA_TIMEZONE);
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

  // These reads don't depend on each other's results (only the subsequent
  // processing below does) — fetched in parallel instead of four
  // sequential round trips.
  const [dayAheadResult, importStatus, currentResult, recentEvents] = await Promise.all([
    dbMarketPriceProvider.getDayAheadPrices({
      referenceDate: referenceInstant,
      timeZone: BULGARIA_TIMEZONE,
    }),
    dbMarketPriceProvider.getLatestImportStatus(),
    isToday ? dbMarketPriceProvider.getCurrentPrice() : Promise.resolve(null),
    params.organizationId ? getRecentAutomationEvents(params.organizationId) : Promise.resolve([]),
  ]);

  if (!dayAheadResult.available) {
    return { dataAvailable: false, threshold, ...toolbarState };
  }

  const { start: periodStart, end: periodEnd } = localDayBoundsUtc(
    referenceInstant,
    BULGARIA_TIMEZONE,
  );

  // A day whose only persisted row is the residual tail hour of the
  // *previous* CET trading day (see `hasOnlyResidualPreviousDayInterval`)
  // has no real data of its own yet, regardless of whether the day is in
  // the past, today, or the future — render the same "no market data" empty
  // state as a day with zero rows (the exact same branch/UI a future day
  // with zero persisted rows already hits above).
  if (hasOnlyResidualPreviousDayInterval(dayAheadResult.prices, periodStart)) {
    return { dataAvailable: false, threshold, ...toolbarState };
  }

  const resolutionMinutes = importStatus.available
    ? importStatus.resolutionMinutes
    : DEFAULT_RESOLUTION_MINUTES;

  const series = buildSeries(
    dayAheadResult.prices,
    periodStart,
    periodEnd,
    resolutionMinutes,
    threshold,
  );

  const knownPoints = series.filter((point) => point.price !== null);

  let currentPrice: MarketSummaryData["currentPrice"] = null;
  let nextInterval: MarketSummaryData["nextInterval"] = null;

  if (isToday && currentResult) {
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
    },
  };

  return {
    dataAvailable: true,
    threshold,
    series,
    isPartialImport: isToday && importStatus.available && importStatus.isPartial,
    summary,
    eventLog: recentEvents.map((event) => ({
      timestamp: event.createdAt,
      type: event.type,
      label: event.summary,
      detail: event.reason,
    })),
    distribution: buildDistribution(knownPoints),
    insights: buildInsights(knownPoints, resolutionMinutes),
    ...toolbarState,
  };
}
