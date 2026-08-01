import { unstable_cache } from "next/cache";
import type { RunStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  bulkDeviceTelemetryDays,
  bulkMarketPriceDays,
  bulkPlantDailyKpiDays,
  enumerateApplicableDays,
} from "@/lib/historical-data/ensure-day-available";
import {
  ENTSOE_MARKET_TIMEZONE,
  formatDateInZone,
  localDayBoundsUtc,
  localMonthBoundsUtc,
} from "@/lib/market-price/timezone";
import { isVercelApiConfigured } from "@/lib/admin/vercel-api";

/**
 * Platform Health & Operations Center milestone. The single query/
 * aggregation module the `/admin/operations` page renders from — every
 * function here is strictly read-only (no mutation anywhere in this file)
 * and reuses existing shared logic (`enumerateApplicableDays`/`bulk*Days`
 * from the Historical Data Coverage milestone) rather than re-deriving its
 * own notion of "which days matter." Nothing here fabricates a value: every
 * field either comes directly from a real table (`HuaweiRequestLog`,
 * `SchedulerRun`, `ImporterRun`, `MarketPrice`, ...) or is a plainly-derived
 * classification of real numbers (e.g. "healthy" vs "warning").
 */

const BULGARIA_TIMEZONE = "Europe/Sofia";

export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

// ---------------------------------------------------------------------------
// Section 11 — FusionSolar Gateway
// ---------------------------------------------------------------------------

export type GatewayHealthResult =
  | { reachable: false; errorMessage: string }
  | {
      reachable: true;
      version: string;
      nodeVersion: string;
      startedAt: Date;
      uptimeSeconds: number;
      allowedApiPaths: string[];
      memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
      cpuPercent: number;
      responseLatencyMs: number;
    };

type RawGatewayHealth = {
  version: string;
  nodeVersion: string;
  startedAt: string;
  uptimeSeconds: number;
  allowedApiPaths: string[];
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
  cpuUsageMicros: { user: number; system: number };
};

/** Calls the gateway's own `/health` endpoint (extended for this milestone — see `docs/infrastructure/scaleway-production.md`). Unauthenticated by design, matching its original minimal form. */
export async function getGatewayHealth(): Promise<GatewayHealthResult> {
  const gatewayUrl = process.env.FUSIONSOLAR_GATEWAY_URL;
  if (!gatewayUrl) {
    return { reachable: false, errorMessage: "FUSIONSOLAR_GATEWAY_URL is not configured" };
  }

  const healthUrl = new URL("/health", gatewayUrl).toString();
  const startedAt = Date.now();

  try {
    const response = await fetch(healthUrl, { cache: "no-store" });
    const responseLatencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return { reachable: false, errorMessage: `Gateway health check failed: HTTP ${response.status}` };
    }

    const data = (await response.json()) as RawGatewayHealth;
    const totalCpuMicros = data.cpuUsageMicros.user + data.cpuUsageMicros.system;
    const cpuPercent =
      data.uptimeSeconds > 0 ? Math.round((totalCpuMicros / 1000 / (data.uptimeSeconds * 1000)) * 10000) / 100 : 0;

    return {
      reachable: true,
      version: data.version,
      nodeVersion: data.nodeVersion,
      startedAt: new Date(data.startedAt),
      uptimeSeconds: data.uptimeSeconds,
      allowedApiPaths: data.allowedApiPaths,
      memory: data.memory,
      cpuPercent,
      responseLatencyMs,
    };
  } catch (error) {
    return { reachable: false, errorMessage: error instanceof Error ? error.message : "unknown_error" };
  }
}

// ---------------------------------------------------------------------------
// Section 2 — Huawei health
// ---------------------------------------------------------------------------

export type HuaweiHealthResult = {
  connections: Array<{
    connectionId: string;
    organizationId: string;
    tokenExpiresAt: Date | null;
    tokenStatus: "valid" | "expiring_soon" | "expired" | "unknown";
  }>;
  lastSuccessfulRequestAt: Date | null;
  lastFailedRequestAt: Date | null;
  averageResponseTimeMs: number | null;
  /** Keys: "429" | "401" | "403" | "5xx" | "other", counted over the last 24h. */
  statusCodeCounts: Record<string, number>;
  /** Requests that never received an HTTP response at all (network/DNS/abort) over the last 24h. */
  timeoutCount: number;
  requestsLast24h: number;
  requestsLastHour: number;
  currentRequestRatePerMinute: number;
};

export async function getHuaweiHealth(): Promise<HuaweiHealthResult> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const connections = await prisma.fusionSolarConnection.findMany({
    select: { id: true, organizationId: true, expiresAt: true },
  });

  const connectionStatuses = connections.map((c) => {
    let tokenStatus: "valid" | "expiring_soon" | "expired" | "unknown" = "unknown";
    if (c.expiresAt) {
      const msRemaining = c.expiresAt.getTime() - now.getTime();
      tokenStatus = msRemaining <= 0 ? "expired" : msRemaining < 10 * 60 * 1000 ? "expiring_soon" : "valid";
    }
    return { connectionId: c.id, organizationId: c.organizationId, tokenExpiresAt: c.expiresAt, tokenStatus };
  });

  const [lastSuccess, lastFailure, recentRequests, requestsLastHour, requestsLast24h] = await Promise.all([
    prisma.huaweiRequestLog.findFirst({
      where: { success: true },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.huaweiRequestLog.findFirst({
      where: { success: false },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.huaweiRequestLog.findMany({
      where: { createdAt: { gte: oneDayAgo } },
      select: { httpStatus: true, durationMs: true },
    }),
    prisma.huaweiRequestLog.count({ where: { createdAt: { gte: oneHourAgo } } }),
    prisma.huaweiRequestLog.count({ where: { createdAt: { gte: oneDayAgo } } }),
  ]);

  const statusCodeCounts: Record<string, number> = {};
  let timeoutCount = 0;
  let totalDurationMs = 0;

  for (const request of recentRequests) {
    if (request.httpStatus === null) {
      timeoutCount += 1;
    } else if (request.httpStatus === 429) {
      statusCodeCounts["429"] = (statusCodeCounts["429"] ?? 0) + 1;
    } else if (request.httpStatus === 401) {
      statusCodeCounts["401"] = (statusCodeCounts["401"] ?? 0) + 1;
    } else if (request.httpStatus === 403) {
      statusCodeCounts["403"] = (statusCodeCounts["403"] ?? 0) + 1;
    } else if (request.httpStatus >= 500) {
      statusCodeCounts["5xx"] = (statusCodeCounts["5xx"] ?? 0) + 1;
    } else if (!(request.httpStatus >= 200 && request.httpStatus < 300)) {
      statusCodeCounts["other"] = (statusCodeCounts["other"] ?? 0) + 1;
    }
    totalDurationMs += request.durationMs;
  }

  return {
    connections: connectionStatuses,
    lastSuccessfulRequestAt: lastSuccess?.createdAt ?? null,
    lastFailedRequestAt: lastFailure?.createdAt ?? null,
    averageResponseTimeMs: recentRequests.length > 0 ? Math.round(totalDurationMs / recentRequests.length) : null,
    statusCodeCounts,
    timeoutCount,
    requestsLast24h: requestsLast24h,
    requestsLastHour,
    currentRequestRatePerMinute: Math.round((requestsLastHour / 60) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Section 3 — ENTSO-E health
// ---------------------------------------------------------------------------

export type EntsoeHealthResult = {
  lastSuccessfulImportAt: Date | null;
  lastFailedImportAt: Date | null;
  lastFailedImportReason: string | null;
  latestImportedMarketDay: string | null;
  /** Missing CET/CEST-equivalent Bulgaria-local days over the last 30 days — bounded, not a full-history scan. */
  missingMarketDays: string[];
  averageImportDurationMs: number | null;
  recentImportErrors: Array<{ occurredAt: Date; message: string }>;
};

const IMPORTER_TYPE_ENTSOE = "entsoe_market_price";

export async function getEntsoeHealth(): Promise<EntsoeHealthResult> {
  const [lastSuccess, lastFailure, latestPrice, recentFailures, avgAgg] = await Promise.all([
    prisma.importerRun.findFirst({
      where: { importerType: IMPORTER_TYPE_ENTSOE, status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.importerRun.findFirst({
      where: { importerType: IMPORTER_TYPE_ENTSOE, status: "FAILED" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.marketPrice.findFirst({ where: { source: "ENTSOE" }, orderBy: { timestamp: "desc" }, select: { timestamp: true } }),
    prisma.importerRun.findMany({
      where: { importerType: IMPORTER_TYPE_ENTSOE, status: "FAILED" },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: { startedAt: true, errorMessage: true },
    }),
    prisma.importerRun.aggregate({
      where: { importerType: IMPORTER_TYPE_ENTSOE, status: "SUCCESS" },
      _avg: { durationMs: true },
    }),
  ]);

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
  const days = enumerateApplicableDays(windowStart, windowEnd);
  const availableDays = await bulkMarketPriceDays(windowStart, windowEnd);
  const missingMarketDays = days.filter((day) => !availableDays.has(day.start.getTime())).map((day) => day.dateStr);

  return {
    lastSuccessfulImportAt: lastSuccess?.startedAt ?? null,
    lastFailedImportAt: lastFailure?.startedAt ?? null,
    lastFailedImportReason: lastFailure?.errorMessage ?? null,
    latestImportedMarketDay: latestPrice ? formatDateInZone(latestPrice.timestamp, ENTSOE_MARKET_TIMEZONE) : null,
    missingMarketDays,
    averageImportDurationMs: avgAgg._avg.durationMs ? Math.round(avgAgg._avg.durationMs) : null,
    recentImportErrors: recentFailures.map((f) => ({ occurredAt: f.startedAt, message: f.errorMessage ?? "unknown_error" })),
  };
}

// ---------------------------------------------------------------------------
// Section 4 — Historical Import Health
// ---------------------------------------------------------------------------

export type HistoricalImportHealthResult = {
  importsLast24h: number;
  importsLast7d: number;
  importsLast30d: number;
  statusCounts: Record<string, number>;
  averageDurationMs: number | null;
  averageImportedDays: number | null;
};

const IMPORTER_TYPE_HISTORICAL = "historical_range";

export async function getHistoricalImportHealth(): Promise<HistoricalImportHealthResult> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [importsLast24h, importsLast7d, importsLast30d, statusRows, agg] = await Promise.all([
    prisma.importerRun.count({ where: { importerType: IMPORTER_TYPE_HISTORICAL, startedAt: { gte: oneDayAgo } } }),
    prisma.importerRun.count({ where: { importerType: IMPORTER_TYPE_HISTORICAL, startedAt: { gte: oneWeekAgo } } }),
    prisma.importerRun.count({ where: { importerType: IMPORTER_TYPE_HISTORICAL, startedAt: { gte: oneMonthAgo } } }),
    prisma.importerRun.groupBy({
      by: ["status"],
      where: { importerType: IMPORTER_TYPE_HISTORICAL, startedAt: { gte: oneMonthAgo } },
      _count: { _all: true },
    }),
    prisma.importerRun.aggregate({
      where: { importerType: IMPORTER_TYPE_HISTORICAL, startedAt: { gte: oneMonthAgo } },
      _avg: { durationMs: true, rowsImported: true },
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of statusRows) {
    statusCounts[row.status] = row._count._all;
  }

  return {
    importsLast24h,
    importsLast7d,
    importsLast30d,
    statusCounts,
    averageDurationMs: agg._avg.durationMs ? Math.round(agg._avg.durationMs) : null,
    averageImportedDays: agg._avg.rowsImported ? Math.round(agg._avg.rowsImported * 10) / 10 : null,
  };
}

// ---------------------------------------------------------------------------
// Section 5 — Scheduler Health
// ---------------------------------------------------------------------------

/** DST-safe "next daily local time" — same `+25h` guess-then-re-derive technique `localDayBoundsUtc` itself documents. */
function nextDailyTimeUtc(from: Date, hour: number, minute: number, timezone: string): Date {
  const { start: todayLocalMidnightUtc } = localDayBoundsUtc(from, timezone);
  const candidateToday = new Date(todayLocalMidnightUtc.getTime() + (hour * 60 + minute) * 60 * 1000);
  if (candidateToday.getTime() > from.getTime()) {
    return candidateToday;
  }
  const tomorrowGuess = new Date(todayLocalMidnightUtc.getTime() + 25 * 60 * 60 * 1000);
  const { start: tomorrowLocalMidnightUtc } = localDayBoundsUtc(tomorrowGuess, timezone);
  return new Date(tomorrowLocalMidnightUtc.getTime() + (hour * 60 + minute) * 60 * 1000);
}

function nextMultipleOfMinutesUtc(from: Date, everyMinutes: number): Date {
  const ms = everyMinutes * 60 * 1000;
  return new Date(Math.ceil((from.getTime() + 1) / ms) * ms);
}

/** Fixed, documented systemd `OnCalendar` cadences — see `docs/infrastructure/scaleway-production.md`. Not queried remotely (this app has no way to ask the VM's systemd directly); "next execution" is a real derivation from known, real configuration, not a guess. */
const SCHEDULER_DEFINITIONS: Array<{
  name: string;
  label: string;
  cadenceDescription: string;
  expectedIntervalMs: number;
  nextExecution: (from: Date) => Date;
}> = [
  {
    name: "telemetry_ingestion",
    label: "Telemetry Ingestion",
    cadenceDescription: "Every 5 minutes",
    expectedIntervalMs: 5 * 60 * 1000,
    nextExecution: (from) => nextMultipleOfMinutesUtc(from, 5),
  },
  {
    name: "market_price_refresh",
    label: "Market Price Scheduler",
    cadenceDescription: "Daily at 14:00 Europe/Sofia",
    expectedIntervalMs: 24 * 60 * 60 * 1000,
    nextExecution: (from) => nextDailyTimeUtc(from, 14, 0, BULGARIA_TIMEZONE),
  },
  {
    name: "automation_execution",
    label: "Automation Execution",
    cadenceDescription: "Every 15 minutes",
    expectedIntervalMs: 15 * 60 * 1000,
    nextExecution: (from) => nextMultipleOfMinutesUtc(from, 15),
  },
  {
    name: "automation_reconciliation",
    label: "Automation Reconciliation",
    cadenceDescription: "Daily at 06:00 Europe/Sofia",
    expectedIntervalMs: 24 * 60 * 60 * 1000,
    nextExecution: (from) => nextDailyTimeUtc(from, 6, 0, BULGARIA_TIMEZONE),
  },
];

export type SchedulerHealthEntry = {
  name: string;
  label: string;
  cadenceDescription: string;
  lastExecutionAt: Date | null;
  lastExecutionStatus: RunStatus | null;
  lastExecutionDurationMs: number | null;
  nextExecutionAt: Date;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  averageDurationMs: number | null;
  maximumDurationMs: number | null;
  /** Derived from real run history against the known expected cadence — not a remote systemd query. */
  appearsActive: boolean;
};

export async function getSchedulerHealth(): Promise<SchedulerHealthEntry[]> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const results: SchedulerHealthEntry[] = [];

  for (const def of SCHEDULER_DEFINITIONS) {
    const [lastRun, statusRows, agg, recentRuns] = await Promise.all([
      prisma.schedulerRun.findFirst({ where: { schedulerName: def.name }, orderBy: { startedAt: "desc" } }),
      prisma.schedulerRun.groupBy({
        by: ["status"],
        where: { schedulerName: def.name, startedAt: { gte: windowStart } },
        _count: { _all: true },
      }),
      prisma.schedulerRun.aggregate({
        where: { schedulerName: def.name, startedAt: { gte: windowStart } },
        _avg: { durationMs: true },
        _max: { durationMs: true },
      }),
      prisma.schedulerRun.findMany({
        where: { schedulerName: def.name },
        orderBy: { startedAt: "desc" },
        take: 20,
        select: { status: true },
      }),
    ]);

    let consecutiveFailures = 0;
    for (const run of recentRuns) {
      if (run.status === "FAILED") {
        consecutiveFailures += 1;
      } else {
        break;
      }
    }

    results.push({
      name: def.name,
      label: def.label,
      cadenceDescription: def.cadenceDescription,
      lastExecutionAt: lastRun?.startedAt ?? null,
      lastExecutionStatus: lastRun?.status ?? null,
      lastExecutionDurationMs: lastRun?.durationMs ?? null,
      nextExecutionAt: def.nextExecution(now),
      successCount: statusRows.find((r) => r.status === "SUCCESS")?._count._all ?? 0,
      failureCount: statusRows.find((r) => r.status === "FAILED")?._count._all ?? 0,
      consecutiveFailures,
      averageDurationMs: agg._avg.durationMs ? Math.round(agg._avg.durationMs) : null,
      maximumDurationMs: agg._max.durationMs ?? null,
      appearsActive: lastRun ? now.getTime() - lastRun.startedAt.getTime() < def.expectedIntervalMs * 3 : false,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Section 8 — Database
// ---------------------------------------------------------------------------

export type DatabaseHealthResult = {
  reachable: boolean;
  latencyMs: number | null;
  currentConnections: number | null;
  latestRecordedMigration: string | null;
  latestMigrationAt: Date | null;
  errorMessage: string | null;
};

export async function getDatabaseHealth(): Promise<DatabaseHealthResult> {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - startedAt;

    let currentConnections: number | null = null;
    try {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint as count FROM pg_stat_activity WHERE datname = current_database()
      `;
      currentConnections = rows[0] ? Number(rows[0].count) : null;
    } catch {
      currentConnections = null;
    }

    let latestRecordedMigration: string | null = null;
    let latestMigrationAt: Date | null = null;
    try {
      const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
        SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1
      `;
      if (migrations[0]) {
        latestRecordedMigration = migrations[0].migration_name;
        latestMigrationAt = migrations[0].finished_at;
      }
    } catch {
      // _prisma_migrations may be absent/unreadable - not itself a database-health failure.
    }

    return {
      reachable: true,
      latencyMs,
      currentConnections,
      latestRecordedMigration,
      latestMigrationAt,
      errorMessage: null,
    };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: null,
      currentConnections: null,
      latestRecordedMigration: null,
      latestMigrationAt: null,
      errorMessage: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

// ---------------------------------------------------------------------------
// Section 9 — Data Integrity (cached: expensive, must not run on every refresh)
// ---------------------------------------------------------------------------

export type DuplicateFinding = {
  groupCount: number;
  excessRows: number;
  samples: Array<Record<string, unknown>>;
};

export type DataIntegrityReport = {
  computedAt: string;
  duplicates: {
    plantDailyKpi: DuplicateFinding;
    deviceTelemetry: DuplicateFinding;
    marketPrice: DuplicateFinding;
    consentLog: DuplicateFinding;
    automationEvent: DuplicateFinding;
  };
  notApplicable: Array<{ label: string; reason: string }>;
  orphanRows: Array<{ table: string; count: number }>;
  missingDaysByOrganization: Array<{
    organizationId: string;
    organizationName: string;
    missingTelemetryDays: number;
    missingDailyKpiDays: number;
    missingMarketPriceDays: number;
  }>;
};

function toDuplicateFinding(
  rows: Array<Record<string, unknown> & { count: bigint }>,
): DuplicateFinding {
  const excessRows = rows.reduce((sum, row) => sum + (Number(row.count) - 1), 0);
  const samples = rows.slice(0, 20).map((row) => {
    const { count, ...rest } = row;
    return { ...rest, count: Number(count) };
  });
  return { groupCount: rows.length, excessRows, samples };
}

async function computeDataIntegrityReport(): Promise<DataIntegrityReport> {
  const [
    duplicatePlantDailyKpi,
    duplicateDeviceTelemetry,
    duplicateMarketPrice,
    duplicateConsentLog,
    duplicateAutomationEvent,
    orphanRows,
    organizationsWithConnections,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ organizationId: string; plantId: string; localDate: Date; count: bigint }>>`
      SELECT "organizationId", "plantId", "localDate", count(*)::bigint as count
      FROM "PlantDailyKpi" GROUP BY "organizationId", "plantId", "localDate" HAVING count(*) > 1
    `,
    prisma.$queryRaw<Array<{ organizationId: string; deviceId: string; timestamp: Date; resolution: string; count: bigint }>>`
      SELECT "organizationId", "deviceId", "timestamp", "resolution", count(*)::bigint as count
      FROM "DeviceTelemetry" GROUP BY "organizationId", "deviceId", "timestamp", "resolution" HAVING count(*) > 1
    `,
    prisma.$queryRaw<Array<{ biddingZone: string; timestamp: Date; source: string; count: bigint }>>`
      SELECT "biddingZone", "timestamp", "source", count(*)::bigint as count
      FROM "MarketPrice" GROUP BY "biddingZone", "timestamp", "source" HAVING count(*) > 1
    `,
    prisma.$queryRaw<Array<{ userId: string | null; version: number; action: string; bucket: Date; count: bigint }>>`
      SELECT "userId", "version", "action", date_trunc('second', "createdAt") as bucket, count(*)::bigint as count
      FROM "ConsentLog"
      GROUP BY "userId", "version", "action", "necessary", "functional", "analytics", "marketing", bucket
      HAVING count(*) > 1
    `,
    prisma.$queryRaw<Array<{ organizationId: string; type: string; newMode: string | null; bucket: Date; count: bigint }>>`
      SELECT "organizationId", "type", "newMode", date_trunc('minute', "createdAt") as bucket, count(*)::bigint as count
      FROM "AutomationEvent"
      GROUP BY "organizationId", "type", "newMode", bucket
      HAVING count(*) > 1
    `,
    prisma.$queryRaw<Array<{ table_name: string; count: bigint }>>`
      SELECT 'DeviceTelemetry' as table_name, count(*)::bigint as count FROM "DeviceTelemetry" dt
      WHERE NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = dt."organizationId")
      UNION ALL
      SELECT 'PlantDailyKpi', count(*)::bigint FROM "PlantDailyKpi" pdk
      WHERE NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = pdk."organizationId")
      UNION ALL
      SELECT 'AutomationEvent', count(*)::bigint FROM "AutomationEvent" ae
      WHERE NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = ae."organizationId")
    `,
    prisma.fusionSolarConnection.findMany({
      select: { organizationId: true, organization: { select: { name: true } } },
      distinct: ["organizationId"],
    }),
  ]);

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
  const days = enumerateApplicableDays(windowStart, windowEnd);

  const missingDaysByOrganization = await Promise.all(
    organizationsWithConnections.map(async (org) => {
      const [telemetryDays, dailyKpiDays] = await Promise.all([
        bulkDeviceTelemetryDays(org.organizationId, windowStart, windowEnd),
        bulkPlantDailyKpiDays(org.organizationId, windowStart, windowEnd),
      ]);

      return {
        organizationId: org.organizationId,
        organizationName: org.organization.name,
        missingTelemetryDays: days.filter((d) => !telemetryDays.has(d.start.getTime())).length,
        missingDailyKpiDays: days.filter((d) => !dailyKpiDays.has(d.start.getTime())).length,
        missingMarketPriceDays: 0, // filled in below (platform-wide, computed once)
      };
    }),
  );

  const marketPriceDays = await bulkMarketPriceDays(windowStart, windowEnd);
  const missingMarketPriceDaysCount = days.filter((d) => !marketPriceDays.has(d.start.getTime())).length;
  for (const entry of missingDaysByOrganization) {
    entry.missingMarketPriceDays = missingMarketPriceDaysCount;
  }

  return {
    computedAt: new Date().toISOString(),
    duplicates: {
      plantDailyKpi: toDuplicateFinding(duplicatePlantDailyKpi),
      deviceTelemetry: toDuplicateFinding(duplicateDeviceTelemetry),
      marketPrice: toDuplicateFinding(duplicateMarketPrice),
      consentLog: toDuplicateFinding(duplicateConsentLog),
      automationEvent: toDuplicateFinding(duplicateAutomationEvent),
    },
    notApplicable: [
      {
        label: "Notification",
        reason: "No standalone Notification model exists in this schema — only NotificationPreferences (per-user settings, not notification instances).",
      },
    ],
    orphanRows: orphanRows.map((row) => ({ table: row.table_name, count: Number(row.count) })),
    missingDaysByOrganization,
  };
}

/** Cached for 5 minutes — the integrity scan is a real cost (several full-table GROUP BYs) and must not run on every page view. */
export const getDataIntegrityReport = unstable_cache(computeDataIntegrityReport, ["platform-health-data-integrity"], {
  revalidate: 300,
});

// ---------------------------------------------------------------------------
// Section 10 — Import Health (generic, across all three shared importers)
// ---------------------------------------------------------------------------

export type ImporterSummary = {
  importerType: string;
  label: string;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  rowsImportedTotal: number;
  rowsSkippedTotal: number;
  rowsFailedTotal: number;
  averageDurationMs: number | null;
};

const IMPORTER_LABELS: Record<string, string> = {
  huawei_telemetry_sync: "Huawei Telemetry + Daily KPI",
  entsoe_market_price: "ENTSO-E Market Price",
  historical_range: "Historical Range Backfill",
};

export async function getImportHealth(): Promise<ImporterSummary[]> {
  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const results: ImporterSummary[] = [];

  for (const [importerType, label] of Object.entries(IMPORTER_LABELS)) {
    const [lastRun, lastSuccess, lastFailure, agg] = await Promise.all([
      prisma.importerRun.findFirst({ where: { importerType }, orderBy: { startedAt: "desc" } }),
      prisma.importerRun.findFirst({ where: { importerType, status: "SUCCESS" }, orderBy: { startedAt: "desc" } }),
      prisma.importerRun.findFirst({ where: { importerType, status: "FAILED" }, orderBy: { startedAt: "desc" } }),
      prisma.importerRun.aggregate({
        where: { importerType, startedAt: { gte: windowStart } },
        _avg: { durationMs: true },
        _sum: { rowsImported: true, rowsSkipped: true, rowsFailed: true },
      }),
    ]);

    results.push({
      importerType,
      label,
      lastRunAt: lastRun?.startedAt ?? null,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      lastFailureAt: lastFailure?.startedAt ?? null,
      rowsImportedTotal: agg._sum.rowsImported ?? 0,
      rowsSkippedTotal: agg._sum.rowsSkipped ?? 0,
      rowsFailedTotal: agg._sum.rowsFailed ?? 0,
      averageDurationMs: agg._avg.durationMs ? Math.round(agg._avg.durationMs) : null,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Section 12 — Performance
// ---------------------------------------------------------------------------

export type PerformanceMetricsResult = {
  historicalImportAverageDurationMs: number | null;
  telemetrySyncAverageDurationMs: number | null;
  largestTelemetrySync: { connectionId: string | null; rowsImported: number; occurredAt: Date } | null;
  largestHistoricalImport: { organizationId: string | null; rowsImported: number; occurredAt: Date } | null;
  /** Dashboard/Market page-render timing is not currently instrumented anywhere in this codebase (no APM). Not fabricated - reported honestly as not yet available, distinct from the Vercel-token-gated widgets. */
  pageLoadTimeInstrumented: false;
};

export async function getPerformanceMetrics(): Promise<PerformanceMetricsResult> {
  const [historicalAgg, telemetryAgg, largestTelemetry, largestHistorical] = await Promise.all([
    prisma.importerRun.aggregate({
      where: { importerType: IMPORTER_TYPE_HISTORICAL, status: "SUCCESS" },
      _avg: { durationMs: true },
    }),
    prisma.importerRun.aggregate({
      where: { importerType: "huawei_telemetry_sync", status: "SUCCESS" },
      _avg: { durationMs: true },
    }),
    prisma.importerRun.findFirst({
      where: { importerType: "huawei_telemetry_sync", status: "SUCCESS" },
      orderBy: { rowsImported: "desc" },
      select: { connectionId: true, rowsImported: true, startedAt: true },
    }),
    prisma.importerRun.findFirst({
      where: { importerType: IMPORTER_TYPE_HISTORICAL, status: "SUCCESS" },
      orderBy: { rowsImported: "desc" },
      select: { organizationId: true, rowsImported: true, startedAt: true },
    }),
  ]);

  return {
    historicalImportAverageDurationMs: historicalAgg._avg.durationMs ? Math.round(historicalAgg._avg.durationMs) : null,
    telemetrySyncAverageDurationMs: telemetryAgg._avg.durationMs ? Math.round(telemetryAgg._avg.durationMs) : null,
    largestTelemetrySync: largestTelemetry
      ? { connectionId: largestTelemetry.connectionId, rowsImported: largestTelemetry.rowsImported, occurredAt: largestTelemetry.startedAt }
      : null,
    largestHistoricalImport: largestHistorical
      ? { organizationId: largestHistorical.organizationId, rowsImported: largestHistorical.rowsImported, occurredAt: largestHistorical.startedAt }
      : null,
    pageLoadTimeInstrumented: false,
  };
}

// ---------------------------------------------------------------------------
// Section 13 — Historical Coverage calendar
// ---------------------------------------------------------------------------

export type CalendarDayStatus = "complete" | "partial" | "missing" | "future";

export type CalendarDay = {
  dateStr: string;
  status: CalendarDayStatus;
  telemetryAvailable: boolean;
  dailyKpiAvailable: boolean;
  marketPriceAvailable: boolean;
};

export async function getHistoricalCoverageCalendar(
  organizationId: string | null,
  year: number,
  month: number,
): Promise<CalendarDay[]> {
  const referenceDate = new Date(Date.UTC(year, month - 1, 15, 12));
  const { start: monthStart, end: monthEnd } = localMonthBoundsUtc(referenceDate, BULGARIA_TIMEZONE);

  const [telemetryDays, dailyKpiDays, marketPriceDays] = await Promise.all([
    organizationId ? bulkDeviceTelemetryDays(organizationId, monthStart, monthEnd) : Promise.resolve(new Set<number>()),
    organizationId ? bulkPlantDailyKpiDays(organizationId, monthStart, monthEnd) : Promise.resolve(new Set<number>()),
    bulkMarketPriceDays(monthStart, monthEnd),
  ]);

  const now = Date.now();
  const results: CalendarDay[] = [];
  let cursor = localDayBoundsUtc(monthStart, BULGARIA_TIMEZONE);

  while (cursor.start.getTime() < monthEnd.getTime()) {
    const dateStr = formatDateInZone(cursor.start, BULGARIA_TIMEZONE);

    if (cursor.end.getTime() > now) {
      results.push({ dateStr, status: "future", telemetryAvailable: false, dailyKpiAvailable: false, marketPriceAvailable: false });
    } else {
      const telemetryAvailable = organizationId !== null && telemetryDays.has(cursor.start.getTime());
      const dailyKpiAvailable = organizationId !== null && dailyKpiDays.has(cursor.start.getTime());
      const marketPriceAvailable = marketPriceDays.has(cursor.start.getTime());
      const relevantFlags = organizationId !== null ? [telemetryAvailable, dailyKpiAvailable, marketPriceAvailable] : [marketPriceAvailable];
      const allAvailable = relevantFlags.every(Boolean);
      const anyAvailable = relevantFlags.some(Boolean);

      results.push({
        dateStr,
        status: allAvailable ? "complete" : anyAvailable ? "partial" : "missing",
        telemetryAvailable,
        dailyKpiAvailable,
        marketPriceAvailable,
      });
    }

    cursor = localDayBoundsUtc(cursor.end, BULGARIA_TIMEZONE);
  }

  return results;
}

/** Organizations with a FusionSolar connection — the calendar's org picker. */
export async function listOrganizationsForCoverageCalendar() {
  return prisma.organization.findMany({
    where: { fusionSolarConnections: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Section 14 — Logs
// ---------------------------------------------------------------------------

export type PlatformLogEntry = {
  id: string;
  occurredAt: Date;
  source: "audit" | "automation" | "scheduler" | "importer";
  message: string;
  organizationId: string | null;
};

export async function getPlatformLogs(filters: {
  organizationId?: string;
  since?: Date;
  search?: string;
  limit?: number;
}): Promise<PlatformLogEntry[]> {
  const limit = filters.limit ?? 100;
  const createdAtFilter = filters.since ? { gte: filters.since } : undefined;

  const [auditLogs, automationEvents, schedulerFailures, importerFailures] = await Promise.all([
    prisma.auditLog.findMany({
      where: { organizationId: filters.organizationId, createdAt: createdAtFilter },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, createdAt: true, action: true, organizationId: true },
    }),
    prisma.automationEvent.findMany({
      where: { organizationId: filters.organizationId, createdAt: createdAtFilter },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, createdAt: true, type: true, organizationId: true, errorMessage: true },
    }),
    prisma.schedulerRun.findMany({
      where: { status: "FAILED", startedAt: createdAtFilter },
      orderBy: { startedAt: "desc" },
      take: limit,
      select: { id: true, startedAt: true, schedulerName: true, errorMessage: true },
    }),
    prisma.importerRun.findMany({
      where: { status: "FAILED", organizationId: filters.organizationId, startedAt: createdAtFilter },
      orderBy: { startedAt: "desc" },
      take: limit,
      select: { id: true, startedAt: true, importerType: true, organizationId: true, errorMessage: true },
    }),
  ]);

  const entries: PlatformLogEntry[] = [
    ...auditLogs.map((l) => ({
      id: `audit-${l.id}`,
      occurredAt: l.createdAt,
      source: "audit" as const,
      message: l.action,
      organizationId: l.organizationId,
    })),
    ...automationEvents.map((e) => ({
      id: `automation-${e.id}`,
      occurredAt: e.createdAt,
      source: "automation" as const,
      message: e.errorMessage ? `${e.type}: ${e.errorMessage}` : e.type,
      organizationId: e.organizationId,
    })),
    ...schedulerFailures.map((s) => ({
      id: `scheduler-${s.id}`,
      occurredAt: s.startedAt,
      source: "scheduler" as const,
      message: `${s.schedulerName} failed: ${s.errorMessage ?? "unknown_error"}`,
      organizationId: null,
    })),
    ...importerFailures.map((i) => ({
      id: `importer-${i.id}`,
      occurredAt: i.startedAt,
      source: "importer" as const,
      message: `${i.importerType} failed: ${i.errorMessage ?? "unknown_error"}`,
      organizationId: i.organizationId,
    })),
  ];

  const filtered = filters.search
    ? entries.filter((e) => e.message.toLowerCase().includes(filters.search!.toLowerCase()))
    : entries;

  return filtered.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Section 1 — Overall Platform Status (rollup)
// ---------------------------------------------------------------------------

export type PlatformOverview = {
  overall: HealthStatus;
  huawei: HealthStatus;
  entsoe: HealthStatus;
  database: HealthStatus;
  gateway: HealthStatus;
  schedulers: HealthStatus;
  imports: HealthStatus;
  /** Always "unknown" until VERCEL_API_TOKEN is configured — never guessed. */
  runtime: HealthStatus;
};

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const [huawei, entsoe, database, gateway, schedulers, historicalHealth] = await Promise.all([
    getHuaweiHealth(),
    getEntsoeHealth(),
    getDatabaseHealth(),
    getGatewayHealth(),
    getSchedulerHealth(),
    getHistoricalImportHealth(),
  ]);

  const huaweiStatus: HealthStatus =
    huawei.lastSuccessfulRequestAt === null
      ? "unknown"
      : (huawei.statusCodeCounts["429"] ?? 0) > 0 || (huawei.statusCodeCounts["5xx"] ?? 0) > 0
        ? "warning"
        : huawei.lastFailedRequestAt !== null &&
            (huawei.lastSuccessfulRequestAt === null || huawei.lastFailedRequestAt > huawei.lastSuccessfulRequestAt)
          ? "critical"
          : "healthy";

  const entsoeStatus: HealthStatus =
    entsoe.lastSuccessfulImportAt === null
      ? "unknown"
      : entsoe.lastFailedImportAt !== null &&
          (entsoe.lastSuccessfulImportAt === null || entsoe.lastFailedImportAt > entsoe.lastSuccessfulImportAt)
        ? "critical"
        : entsoe.missingMarketDays.length > 2
          ? "warning"
          : "healthy";

  const databaseStatus: HealthStatus = !database.reachable
    ? "critical"
    : database.latencyMs !== null && database.latencyMs > 1000
      ? "warning"
      : "healthy";

  const gatewayStatus: HealthStatus = gateway.reachable ? "healthy" : "critical";

  const schedulersStatus: HealthStatus = schedulers.some((s) => s.consecutiveFailures >= 3)
    ? "critical"
    : schedulers.some((s) => s.consecutiveFailures >= 1 || !s.appearsActive)
      ? "warning"
      : "healthy";

  const importsStatus: HealthStatus = (historicalHealth.statusCounts["FAILED"] ?? 0) > 0 ? "warning" : "healthy";

  const runtimeStatus: HealthStatus = "unknown";

  const votingStatuses = [huaweiStatus, entsoeStatus, databaseStatus, gatewayStatus, schedulersStatus, importsStatus];
  const overall: HealthStatus = votingStatuses.includes("critical")
    ? "critical"
    : votingStatuses.includes("warning")
      ? "warning"
      : votingStatuses.every((s) => s === "healthy")
        ? "healthy"
        : "unknown";

  return {
    overall,
    huawei: huaweiStatus,
    entsoe: entsoeStatus,
    database: databaseStatus,
    gateway: gatewayStatus,
    schedulers: schedulersStatus,
    imports: importsStatus,
    runtime: runtimeStatus,
  };
}

export { isVercelApiConfigured };
