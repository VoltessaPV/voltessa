import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveOrganizationViewAccess } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getDashboardPageData } from "@/app/[locale]/(platform)/dashboard/dashboard-data";
import { getMarketPageData } from "@/app/[locale]/(platform)/market/market-data";
import { getProductionPageData } from "@/app/[locale]/(platform)/market/production-data";
import { getPlantDailyKpiRange } from "@/lib/telemetry/plant-daily-kpi";
import { getPlantSettlementEnergySeries } from "@/lib/telemetry/energy-metrics";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import { periodBoundsUtc, type CalendarPeriod } from "@/lib/market-price/timezone";
import { resolvePlantContext } from "@/lib/telemetry/plant-context";

/** TEMPORARY performance-validation diagnostic route for the Database-First Architecture milestone. Removed before this milestone ships. Same bearer-secret pattern as app/api/internal/**. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return false;
  return secretsMatch(auth.slice("Bearer ".length), secret);
}

async function time<T>(timings: Record<string, number>, label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const result = await fn();
  timings[label] = Math.round((performance.now() - t0) * 10) / 10;
  return result;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const period = (params.get("period") ?? "month") as CalendarPeriod;
  const date = params.get("date") ?? "2026-07-15";

  const timings: Record<string, number> = {};
  const totalStart = performance.now();

  const huaweiCountBefore = await prisma.huaweiRequestLog.count();
  const entsoeRunsBefore = await prisma.importerRun.count({ where: { importerType: "entsoe_market_price" } });
  const historicalRunsBefore = await prisma.importerRun.count({ where: { importerType: "historical_range" } });

  const session = await time(timings, "authentication (auth())", () => auth());

  const { organizationId } = await time(timings, "authorization (resolveOrganizationViewAccess)", () =>
    resolveOrganizationViewAccess(),
  );

  if (!organizationId) {
    return NextResponse.json({ ok: false, error: "no_organization" }, { status: 500 });
  }

  const { start, end } = periodBoundsUtc(period, new Date(`${date}T12:00:00Z`), "Europe/Sofia");

  const context = await resolvePlantContext(organizationId);
  if (!context) {
    return NextResponse.json({ ok: false, error: "no_plant" }, { status: 500 });
  }

  await time(timings, "DB query - PlantDailyKpi (range)", () => getPlantDailyKpiRange(context.plant.id, start, end));
  await time(timings, "DB query - DeviceTelemetry (settlement series)", () =>
    getPlantSettlementEnergySeries(context.plant.id, start, end),
  );
  await time(timings, "DB query - MarketPrice (range)", () => dbMarketPriceProvider.getPricesInRange({ start, end }));

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId },
    select: { minimumExportPrice: true, currency: true, automationEnabled: true },
  });

  await time(timings, "getMarketPageData (aggregation, full)", () =>
    getMarketPageData({ organizationId, selectedDateParam: date, period, automationSettings }),
  );
  await time(timings, "getProductionPageData (aggregation, full)", () =>
    getProductionPageData(organizationId, date, period),
  );
  await time(timings, "getDashboardPageData (KPI + chart aggregation, full end-to-end)", () =>
    getDashboardPageData(organizationId, automationSettings, date, period),
  );

  timings["TOTAL (sequential sum above, excludes React rendering)"] =
    Math.round((performance.now() - totalStart) * 10) / 10;

  const huaweiCountAfter = await prisma.huaweiRequestLog.count();
  const entsoeRunsAfter = await prisma.importerRun.count({ where: { importerType: "entsoe_market_price" } });
  const historicalRunsAfter = await prisma.importerRun.count({ where: { importerType: "historical_range" } });

  return NextResponse.json({
    ok: true,
    period,
    date,
    authenticatedAs: session?.user?.email ?? null,
    timings,
    externalCallVerification: {
      newHuaweiRequestLogRows: huaweiCountAfter - huaweiCountBefore,
      newEntsoeImporterRuns: entsoeRunsAfter - entsoeRunsBefore,
      newHistoricalRangeImporterRuns: historicalRunsAfter - historicalRunsBefore,
    },
  });
}
