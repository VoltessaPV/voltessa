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

import { getTranslations } from "next-intl/server";

import {
  getRecentAutomationEvents,
  type AutomationEventType,
} from "@/lib/automation/automation-events";
import {
  translateAutomationEventSummary,
  translateDecisionReason,
} from "@/lib/automation/automation-event-i18n";
import {
  isExportRecommended,
  resolveExportThreshold,
  type ExportThresholdConfig,
} from "@/lib/automation/export-threshold-config";
import { DEFAULT_RESOLUTION_MINUTES } from "@/lib/market-price/constants";
import {
  DASHBOARD_RECOVERY_DEADLINE_MS,
  ensureBulgariaDeliveryDayAvailable,
} from "@/lib/market-price/ensure-delivery-day-available";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import {
  formatDateInZone,
  formatPeriodRangeLabel,
  periodBoundsUtc,
  previousPeriodBoundsUtc,
  type CalendarPeriod,
} from "@/lib/market-price/timezone";

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

/**
 * Dashboard & Market Analytics milestone: `isToday` keeps its exact
 * pre-existing meaning (`period === "today" && selectedDate ===` today's
 * date) — the Current Price/Next Interval fields below already gate on
 * this flag, so Week/Month/Year automatically fall through to the same
 * "not today" rendering a browsed historical day already used.
 */
export type MarketToolbarState = {
  period: CalendarPeriod;
  selectedDate: string;
  isToday: boolean;
  prevDateParam: string;
  nextDateParam: string;
  periodRangeLabel: string;
};

export type MarketPageResult =
  | ({
      dataAvailable: false;
      threshold: ExportThresholdConfig;
    } & MarketToolbarState)
  | ({
      dataAvailable: true;
      threshold: ExportThresholdConfig;
      /**
       * Real price points at native resolution across the whole selected
       * period — one day's worth (unchanged) for "today", up to a full
       * year's worth for "year". This is what Insights/Distribution/Revenue
       * are computed from. Historical Analytics Refinement milestone:
       * `page.tsx` also feeds this (paired with
       * `production-data.ts`'s `settlementEnergySeries`) into the Price &
       * Export chart's real Average Selling Price computation for
       * Week/Month/Year — that combination lives in `page.tsx`, not here,
       * since this module deliberately never imports `production-data.ts`
       * (see this file's own top doc comment).
       */
      series: MarketPricePoint[];
      /**
       * Same shape as `series`, for the previous calendar period — only
       * present when `period !== "today"`. `page.tsx` feeds this into the
       * same `computeExportRevenue` the current period already uses
       * (paired with `production-data.ts`'s
       * `previousPeriodSettlementEnergySeries`) for the Revenue card's
       * ▲/▼ comparison, rather than a second revenue calculation.
       */
      previousPeriodSeries?: MarketPricePoint[];
      isPartialImport: boolean;
      summary: MarketSummaryData;
      eventLog: MarketEventLogEntry[];
      distribution: DistributionBucket[];
      insights: MarketInsight[];
    } & MarketToolbarState);

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

/**
 * Dashboard & Market Analytics milestone (Weekly/Monthly/Yearly). Date +
 * time ("28 Jul, 14:30") — used by `buildInsights`'s Highest/Lowest price
 * entries, which can now describe a moment anywhere within a whole
 * calendar week/month/year, not just today; a bare time-of-day (what
 * `sofiaTimeLabel` gives) would be ambiguous once the period spans more
 * than one day.
 */
function sofiaDateTimeShortLabel(date: Date): string {
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/Sofia",
    day: "numeric",
    month: "short",
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
  tDistribution: (key: "high" | "mid" | "low") => string,
): DistributionBucket[] {
  // Three bands, High-to-Low (Market Dashboard UX Polish milestone) —
  // deliberately not five: "Negative" collapses into Low (< 75) and "Peak"
  // collapses into High (> 150), since the milestone's spec names exactly
  // these three bands and colors (High=green, Mid=blue, Low=amber),
  // ordered High first.
  const buckets = [
    { label: tDistribution("high"), rangeLabel: "> 150", min: 150, max: Infinity, colorClass: DISTRIBUTION_HIGH_COLOR_CLASS },
    { label: tDistribution("mid"), rangeLabel: "75–150", min: 75, max: 150, colorClass: "bg-blue-400" },
    { label: tDistribution("low"), rangeLabel: "< 75", min: -Infinity, max: 75, colorClass: DISTRIBUTION_LOW_COLOR_CLASS },
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
  tInsights: (key: string, values?: Record<string, string | number>) => string,
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

  // Dashboard & Market Analytics milestone: a plain count of negative-price
  // intervals, same statistic shape as hoursAbove/BelowThreshold above —
  // meaningful over any period length, so this row is included for
  // "today" too, not just Week/Month/Year.
  const negativePriceCount = knownPoints.filter(
    (point) => point.price !== null && point.price < 0,
  ).length;
  const negativePriceHours = Math.round(negativePriceCount * intervalHours * 10) / 10;

  return [
    {
      text: tInsights("highestPrice", {
        price: highest.price,
        time: sofiaDateTimeShortLabel(highest.timestamp),
      }),
      tone: "warning",
      dotColorClass: DISTRIBUTION_HIGH_COLOR_CLASS,
    },
    {
      text: tInsights("lowestPrice", {
        price: lowest.price,
        time: sofiaDateTimeShortLabel(lowest.timestamp),
      }),
      tone: "positive",
      dotColorClass: DISTRIBUTION_LOW_COLOR_CLASS,
    },
    { text: tInsights("priceSpread", { spread }), tone: "neutral" },
    { text: tInsights("averagePrice", { price: averagePrice }), tone: "neutral" },
    { text: tInsights("hoursAboveThreshold", { hours: hoursAboveThreshold }), tone: "positive" },
    { text: tInsights("hoursBelowThreshold", { hours: hoursBelowThreshold }), tone: "neutral" },
    { text: tInsights("negativePriceHours", { hours: negativePriceHours }), tone: "neutral" },
  ];
}

/** `YYYY-MM-DD` or `YYYY-MM` bucket key for a given instant, in Europe/Sofia — same technique `dashboard-data.ts`'s own `bucketKey` uses, duplicated per this codebase's established small-helper convention rather than a shared utility module. */
/** Builds the translated `MarketEventLogEntry[]` shared by both branches of `getMarketPageData` below — extracted so neither branch duplicates this mapping. */
function buildEventLog(
  recentEvents: Awaited<ReturnType<typeof getRecentAutomationEvents>>,
  tEventLog: Awaited<ReturnType<typeof getTranslations<"automations.eventLog">>>,
  tDecisionReasons: Awaited<ReturnType<typeof getTranslations<"automations.eventLog.decisionReasons">>>,
  tTerm: Awaited<ReturnType<typeof getTranslations<"terminology">>>,
): MarketEventLogEntry[] {
  return recentEvents.map((event) => ({
    timestamp: event.createdAt,
    type: event.type,
    // next-intl's translators are typed against a static, literal key
    // union; these two helpers deliberately look up a DYNAMIC key (a
    // runtime `ExportDecisionReasonCode` value) from a known closed set,
    // which is exactly the case next-intl's own typed-keys feature can't
    // express statically - the `as never` casts here are that documented,
    // narrow escape hatch (same pattern used in
    // lib/notifications/automation-notifications.ts), not a general
    // loosening of translation type-safety elsewhere.
    label: translateAutomationEventSummary(
      (key, values) => tEventLog(key as never, values as never),
      (key) => tTerm(key as never),
      event,
    ),
    // automation_service_failed's reason is raw diagnostic text (out of
    // this fix's scope, see AutomationEvent.reason's schema comment);
    // only mode_changed's reason is a translatable decision-reason code.
    detail:
      event.type === "mode_changed"
        ? translateDecisionReason(
            (key, values) => tDecisionReasons(key as never, values as never),
            (key) => tTerm(key as never),
            event.reason,
          )
        : event.reason,
  }));
}

export async function getMarketPageData(params: {
  /** Null for a Trader Workspace with no client selected - the platform-wide price series is still computed, only the organization-scoped event log is skipped. */
  organizationId: string | null;
  selectedDateParam: string | undefined;
  period?: CalendarPeriod;
  automationSettings: {
    minimumExportPrice: { toString(): string };
    currency: string;
  } | null;
}): Promise<MarketPageResult> {
  const period = params.period ?? "today";
  const todayDateStr = formatDateInZone(new Date(), BULGARIA_TIMEZONE);
  const selectedDate =
    params.selectedDateParam && isValidDateString(params.selectedDateParam)
      ? params.selectedDateParam
      : todayDateStr;
  // Dashboard & Market Analytics milestone: `isToday` keeps its exact
  // pre-existing meaning for the literal "today" period — Week/Month/Year
  // simply never satisfy it, so Current Price/Next Interval fall through
  // to the same "not available" rendering a browsed historical day
  // already used.
  const isToday = period === "today" && selectedDate === todayDateStr;
  const referenceInstant = new Date(`${selectedDate}T12:00:00Z`);

  const threshold = resolveExportThreshold(params.automationSettings);

  // Replaces the old `shiftDateString`-based day-only prev/next — for
  // `period === "today"` this resolves to the exact same calendar day
  // (`periodBoundsUtc("today", ...)` === `localDayBoundsUtc(...)`), so the
  // existing single-day toolbar behavior is unchanged; Week/Month/Year get
  // real period-length navigation for free from the same computation.
  const { start: periodStart, end: periodEnd } = periodBoundsUtc(
    period,
    referenceInstant,
    BULGARIA_TIMEZONE,
  );

  const toolbarState: MarketToolbarState = {
    period,
    selectedDate,
    isToday,
    prevDateParam: formatDateInZone(new Date(periodStart.getTime() - 1), BULGARIA_TIMEZONE),
    nextDateParam: formatDateInZone(periodEnd, BULGARIA_TIMEZONE),
    periodRangeLabel: formatPeriodRangeLabel(period, periodStart, periodEnd, BULGARIA_TIMEZONE),
  };

  if (period !== "today") {
    // Dashboard & Market Analytics milestone (Weekly/Monthly/Yearly). A
    // new, separate branch rather than threading period-awareness through
    // every line of the existing "today" path below — that path (day-ahead
    // fetch, current/next interval, the residual-previous-day guard) is
    // specific to a single calendar day and stays completely untouched.
    const { start: previousStart, end: previousEnd } = previousPeriodBoundsUtc(
      period,
      periodStart,
      BULGARIA_TIMEZONE,
    );

    const [
      rangeResult,
      previousRangeResult,
      importStatus,
      recentEvents,
      tEventLog,
      tDecisionReasons,
      tTerm,
      tDistribution,
      tInsights,
      tInfo,
    ] = await Promise.all([
      dbMarketPriceProvider.getPricesInRange({ start: periodStart, end: periodEnd }),
      dbMarketPriceProvider.getPricesInRange({ start: previousStart, end: previousEnd }),
      dbMarketPriceProvider.getLatestImportStatus(),
      params.organizationId ? getRecentAutomationEvents(params.organizationId) : Promise.resolve([]),
      getTranslations("automations.eventLog"),
      getTranslations("automations.eventLog.decisionReasons"),
      getTranslations("terminology"),
      getTranslations("market.distribution"),
      getTranslations("market.insights"),
      getTranslations("market.info"),
    ]);

    if (!rangeResult.available) {
      return { dataAvailable: false, threshold, ...toolbarState };
    }

    const resolutionMinutes = importStatus.available
      ? importStatus.resolutionMinutes
      : DEFAULT_RESOLUTION_MINUTES;

    const series = buildSeries(rangeResult.prices, periodStart, periodEnd, resolutionMinutes, threshold);
    const knownPoints = series.filter(
      (point): point is MarketPricePoint & { price: number } => point.price !== null,
    );

    if (knownPoints.length === 0) {
      return { dataAvailable: false, threshold, ...toolbarState };
    }

    const lowestKnown = knownPoints.reduce((min, point) => (point.price < min.price ? point : min));
    const highestKnown = knownPoints.reduce((max, point) => (point.price > max.price ? point : max));

    const summary: MarketSummaryData = {
      // A single "current price" has no meaning over a multi-day period —
      // same "unavailable" rendering the existing UI already uses for a
      // browsed historical single day.
      currentPrice: null,
      nextInterval: null,
      lowestToday: { value: lowestKnown.price, intervalLabel: sofiaTimeLabel(lowestKnown.timestamp) },
      highestToday: { value: highestKnown.price, intervalLabel: sofiaTimeLabel(highestKnown.timestamp) },
      marketStatus: {
        country: tInfo("countryName"),
        source: "ENTSO-E",
        healthy: importStatus.available ? !importStatus.isPartial : false,
      },
    };

    const previousPeriodSeries = previousRangeResult.available
      ? buildSeries(previousRangeResult.prices, previousStart, previousEnd, resolutionMinutes, threshold)
      : undefined;

    return {
      dataAvailable: true,
      threshold,
      series,
      previousPeriodSeries,
      isPartialImport: false,
      summary,
      eventLog: buildEventLog(recentEvents, tEventLog, tDecisionReasons, tTerm),
      distribution: buildDistribution(knownPoints, (key) => tDistribution(key)),
      insights: buildInsights(knownPoints, resolutionMinutes, (key, values) =>
        tInsights(key as never, values as never),
      ),
      ...toolbarState,
    };
  }

  // On-Demand Delivery Day Recovery milestone: a no-op whenever
  // `periodStart`'s Bulgaria-local day is already complete, out of the
  // allowed recovery range, or in the future - only ever does real work
  // (behind its own advisory lock) when this specific browsed/dashboard day
  // is genuinely missing or incomplete. Awaited BEFORE the reads below so a
  // freshly-recovered day is what this request actually sees, not stale
  // "unavailable" data from before recovery ran.
  await ensureBulgariaDeliveryDayAvailable(periodStart, DASHBOARD_RECOVERY_DEADLINE_MS);

  // These reads don't depend on each other's results (only the subsequent
  // processing below does) — fetched in parallel instead of four
  // sequential round trips.
  const [
    dayAheadResult,
    importStatus,
    currentResult,
    recentEvents,
    tEventLog,
    tDecisionReasons,
    tTerm,
    tDistribution,
    tInsights,
    tInfo,
  ] = await Promise.all([
    dbMarketPriceProvider.getDayAheadPrices({
      referenceDate: referenceInstant,
      timeZone: BULGARIA_TIMEZONE,
    }),
    dbMarketPriceProvider.getLatestImportStatus(),
    isToday ? dbMarketPriceProvider.getCurrentPrice() : Promise.resolve(null),
    params.organizationId ? getRecentAutomationEvents(params.organizationId) : Promise.resolve([]),
    getTranslations("automations.eventLog"),
    getTranslations("automations.eventLog.decisionReasons"),
    getTranslations("terminology"),
    getTranslations("market.distribution"),
    getTranslations("market.insights"),
    getTranslations("market.info"),
  ]);

  if (!dayAheadResult.available) {
    return { dataAvailable: false, threshold, ...toolbarState };
  }

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
      country: tInfo("countryName"),
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
    eventLog: buildEventLog(recentEvents, tEventLog, tDecisionReasons, tTerm),
    distribution: buildDistribution(knownPoints, (key) => tDistribution(key)),
    insights: buildInsights(knownPoints, resolutionMinutes, (key, values) =>
      tInsights(key as never, values as never),
    ),
    ...toolbarState,
  };
}
