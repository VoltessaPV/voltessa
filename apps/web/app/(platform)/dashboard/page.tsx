import { requireOnboardedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { DashboardMarketWidget } from "@/components/dashboard/DashboardMarketWidget";
import { EnergyFlowDiagram } from "@/components/dashboard/EnergyFlowDiagram";
import { GlidepathCard } from "@/components/dashboard/GlidepathCard";
import { InvertersCard } from "@/components/dashboard/InvertersCard";
import { LiveEnergyChart } from "@/components/dashboard/LiveEnergyChart";
import { WeatherCard } from "@/components/dashboard/WeatherCard";
import { MarketEventLog } from "@/components/market/MarketEventLog";
import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";

import { getDashboardPageData } from "./dashboard-data";

/**
 * Final Dashboard UX Refinement milestone: Market is the finished visual
 * reference (financial decisions); this page is the operational control
 * center (live plant operation). Every KPI/card here reads from
 * `dashboard-data.ts`, which composes Market's own already-proven
 * functions (`getMarketPageData`, `getProductionPageData`,
 * `computeExportRevenue`, `energy-metrics.ts`) rather than recomputing
 * anything — see that module's doc comment. No metric appears more than
 * once across Dashboard + Market combined.
 */

/**
 * Full date+time, always in Europe/Sofia — never the bare
 * `.toLocaleString()` default, which would render in the server's own
 * timezone (UTC on Vercel) rather than the plant's real local time.
 */
function sofiaDateTimeLabel(date: Date): string {
  return date.toLocaleString("en-GB", { timeZone: "Europe/Sofia" });
}

function energyValueLabel(kwh: number | null): string | undefined {
  return kwh !== null ? kwh.toFixed(1) : undefined;
}

export default async function DashboardPage() {
  const user = await requireOnboardedUser();

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId: user.organizationId },
  });

  const data = await getDashboardPageData(user.organizationId, automationSettings);

  return (
    <div className="mx-auto max-w-7xl space-y-3">
      <section className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-cyan-400">Live plant operation</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-white">
            Dashboard
          </h1>
        </div>
      </section>

      {!data.plantAvailable ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
          <p className="text-sm font-medium text-white">No plant connected</p>
          <p className="mt-1 text-xs text-slate-500">
            Connect a FusionSolar plant to see live operational data.
          </p>
        </section>
      ) : (
        <>
          <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            <MarketSummaryCard
              eyebrow="Produced Today"
              value={energyValueLabel(data.kpis.producedTodayKwh)}
              valueUnit={data.kpis.producedTodayKwh !== null ? "kWh" : undefined}
              unavailableNote="Waiting for telemetry"
            />

            <MarketSummaryCard
              eyebrow="Consumed Today"
              value={energyValueLabel(data.kpis.consumedTodayKwh)}
              valueUnit={data.kpis.consumedTodayKwh !== null ? "kWh" : undefined}
              unavailableNote="Waiting for telemetry"
            />

            <MarketSummaryCard
              eyebrow="Exported Today"
              value={energyValueLabel(data.kpis.exportedTodayKwh)}
              valueUnit={data.kpis.exportedTodayKwh !== null ? "kWh" : undefined}
              unavailableNote="Waiting for telemetry"
            />

            <MarketSummaryCard
              eyebrow="Imported Today"
              value={energyValueLabel(data.kpis.importedTodayKwh)}
              valueUnit={data.kpis.importedTodayKwh !== null ? "kWh" : undefined}
              unavailableNote="Waiting for telemetry"
            />

            <MarketSummaryCard
              eyebrow="Revenue Today"
              value={data.kpis.revenue.available ? data.kpis.revenue.revenueEur.toFixed(2) : undefined}
              valueUnit={data.kpis.revenue.available ? "EUR" : undefined}
              unavailableNote="Waiting for production telemetry"
            />
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
            <div>
              <h2 className="text-sm font-semibold text-white">System Overview</h2>
              <p className="mt-0.5 text-xs text-slate-500">Real-time energy flow</p>
            </div>

            <div className="mt-3">
              <EnergyFlowDiagram flow={data.energyFlow} />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Live Energy</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Today&apos;s production, consumption, and grid exchange
              </p>
            </div>

            <div className="mt-2.5 h-[200px] sm:h-[280px] lg:h-[320px] xl:h-[380px]">
              <LiveEnergyChart data={data.chartSeries} />
            </div>
          </section>

          <section className="grid gap-2.5 lg:grid-cols-3">
            <WeatherCard weather={data.weather} />
            <GlidepathCard glidepath={data.glidepath} />
            <DashboardMarketWidget market={data.market} />
          </section>

          <section className="grid gap-2.5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <InvertersCard inverters={data.inverters} />
            </div>
            <MarketEventLog entries={data.eventLog} />
          </section>

          <p className="text-xs text-slate-500">
            Last telemetry:{" "}
            <span className="text-slate-300">
              {data.latestTelemetryAt ? sofiaDateTimeLabel(data.latestTelemetryAt) : "No data"}
            </span>
          </p>
        </>
      )}
    </div>
  );
}
