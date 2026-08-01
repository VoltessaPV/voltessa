import { importDeviceTelemetry } from "@/lib/fusionsolar/import-device-telemetry";
import { importPlantDailyKpiRange } from "@/lib/fusionsolar/import-plant-daily-kpi";
import { ensureMarketPricesForBulgariaDay } from "@/lib/market-price/refresh-market-prices";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

/**
 * Historical Data Auto-Import milestone. The single shared backend service
 * Dashboard and Market both call before rendering a historical day —
 * mirrors `lib/fusionsolar/telemetry-sync-service.ts`'s own role for live
 * telemetry freshness: pages ask "is this day's data available," never
 * "how do I import FusionSolar/ENTSO-E data myself." No React
 * component/page ever calls `importDeviceTelemetry`, `importPlantDailyKpiRange`,
 * or `ensureMarketPricesForBulgariaDay` directly — only this file does.
 *
 * Checks first, imports only what's missing, never re-fetches what's
 * already in Postgres. Idempotent by construction — every importer this
 * calls already upserts/skips-duplicates on its own unique key, so calling
 * this repeatedly for the same day (e.g. the user reopening it) is always
 * safe and, once the day is fully imported, performs zero Huawei/ENTSO-E
 * requests (every check below is a plain `findFirst`/`count` against
 * already-stored rows).
 *
 * Scoped to one Bulgaria-local calendar day at a time by design — the same
 * three checks/imports below are exactly the building block a future
 * Week/Month/Year backfill would loop over one day at a time, importing
 * only the days that come back missing; this file does not implement that
 * loop yet (out of scope for this milestone), but nothing here assumes
 * "day" ever means anything but one single calendar day.
 *
 * Never called for today or the future: today's data is kept fresh by
 * `ensureTelemetryFresh`/the live schedulers instead, and Huawei/ENTSO-E
 * have nothing to report for a day that hasn't happened yet.
 */
export type HistoricalDayAvailability = {
  dateStr: string;
  /** `false` when `dateStr` resolves to today or the future — callers must not treat this as a historical-import result. */
  applicable: boolean;
  telemetryAvailable: boolean;
  dailyKpiAvailable: boolean;
  marketPriceAvailable: boolean;
  telemetryError: string | null;
  dailyKpiError: string | null;
  marketPriceError: string | null;
};

const BULGARIA_TIMEZONE = "Europe/Sofia";

async function hasDeviceTelemetry(organizationId: string, start: Date, end: Date): Promise<boolean> {
  const row = await prisma.deviceTelemetry.findFirst({
    where: { organizationId, timestamp: { gte: start, lt: end } },
    select: { id: true },
  });
  return row !== null;
}

async function hasPlantDailyKpi(organizationId: string, start: Date): Promise<boolean> {
  const row = await prisma.plantDailyKpi.findFirst({
    where: { organizationId, localDate: start },
    select: { id: true },
  });
  return row !== null;
}

async function hasMarketPrices(start: Date, end: Date): Promise<boolean> {
  const row = await prisma.marketPrice.findFirst({
    where: { timestamp: { gte: start, lt: end } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * `organizationId: null` covers Market's Trader-with-no-selected-client
 * view (see `market/page.tsx`) — `MarketPrice` is platform-wide and has no
 * `organizationId` at all (per its own schema), so ENTSO-E import still
 * runs; there is simply no plant to scope a `DeviceTelemetry`/`PlantDailyKpi`
 * import to, so that half is skipped and reported unavailable.
 */
export async function ensureHistoricalDayAvailable(params: {
  organizationId: string | null;
  dateStr: string;
}): Promise<HistoricalDayAvailability> {
  const { organizationId, dateStr } = params;
  const { start, end } = localDayBoundsUtc(new Date(`${dateStr}T12:00:00Z`), BULGARIA_TIMEZONE);

  if (end.getTime() > Date.now()) {
    return {
      dateStr,
      applicable: false,
      telemetryAvailable: false,
      dailyKpiAvailable: false,
      marketPriceAvailable: false,
      telemetryError: null,
      dailyKpiError: null,
      marketPriceError: null,
    };
  }

  let telemetryAvailable = organizationId !== null && (await hasDeviceTelemetry(organizationId, start, end));
  let dailyKpiAvailable = organizationId !== null && (await hasPlantDailyKpi(organizationId, start));
  let marketPriceAvailable = await hasMarketPrices(start, end);

  let telemetryError: string | null = null;
  let dailyKpiError: string | null = null;
  let marketPriceError: string | null = null;

  if (organizationId !== null && (!telemetryAvailable || !dailyKpiAvailable)) {
    const connection = await prisma.fusionSolarConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: "HuaweiFusionSolar" } },
      select: {
        id: true,
        accessToken: true,
        refreshToken: true,
        tokenType: true,
        scope: true,
        expiresAt: true,
      },
    });

    if (connection) {
      const plants = await prisma.plant.findMany({
        where: { organizationId, vendor: "Huawei" },
        select: { id: true },
      });

      if (!telemetryAvailable) {
        try {
          for (const plant of plants) {
            await importDeviceTelemetry({
              connection,
              organizationId,
              plantId: plant.id,
              windowStart: start,
              windowEnd: end,
            });
          }
          telemetryAvailable = await hasDeviceTelemetry(organizationId, start, end);
        } catch (error) {
          telemetryError = error instanceof Error ? error.message : "unknown_error";
        }
      }

      if (!dailyKpiAvailable) {
        try {
          await importPlantDailyKpiRange(organizationId, connection, { start, end });
          dailyKpiAvailable = await hasPlantDailyKpi(organizationId, start);
        } catch (error) {
          dailyKpiError = error instanceof Error ? error.message : "unknown_error";
        }
      }
    }
  }

  if (!marketPriceAvailable) {
    try {
      const result = await ensureMarketPricesForBulgariaDay(start);
      if (result.errors.length > 0) {
        marketPriceError = result.errors.join("; ");
      }
      marketPriceAvailable = await hasMarketPrices(start, end);
    } catch (error) {
      marketPriceError = error instanceof Error ? error.message : "unknown_error";
    }
  }

  return {
    dateStr,
    applicable: true,
    telemetryAvailable,
    dailyKpiAvailable,
    marketPriceAvailable,
    telemetryError,
    dailyKpiError,
    marketPriceError,
  };
}
