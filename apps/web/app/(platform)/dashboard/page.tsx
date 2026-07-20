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
 * Design-System Consistency milestone: rebuilt from `market/page.tsx` (the
 * reference implementation), not evolved from the previous Dashboard. The
 * base layout below - outer container, header, KPI-row grid, chart-section
 * wrapper, bottom four-card grid - is Market's own skeleton, class for
 * class (`mx-auto max-w-7xl space-y-3`, the exact chart-section shadow,
 * `grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4`). "Dashboard is Market plus
 * operational information": the only sections with no Market equivalent are
 * System Overview and Inverters, each its own section below the shared
 * skeleton, never patched into it.
 *
 * ## Dashboard UI Refinement (Final Design Pass) milestone
 *
 * UI/UX only — every value below still comes from `dashboard-data.ts`
 * unchanged (plus `totalYieldKwh`/`consumedFromPvKwh`, additive fields on
 * the same already-fetched data, see that module's doc comment). This pass
 * only changes: the top KPI row (six cards, Revenue dropped since it's
 * already shown on Market), global terminology (`Produced Today` -> `Yield
 * Today`, `Consumed Today` -> `Consumption Today`, `Exported Today` -> `Fed
 * to Grid`, `Imported Today` -> `From Grid` — see `LiveEnergyChart.tsx` for
 * the matching real-time-chart renames), and small icons on the bottom
 * cards' headers (via `lucide-react`, already a dependency).
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
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-white">Dashboard</h1>
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
          <section className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            <MarketSummaryCard
              eyebrow="Yield Today"
              value={energyValueLabel(data.kpis.producedTodayKwh)}
              valueUnit={data.kpis.producedTodayKwh !== null ? "kWh" : undefined}
              unavailableNote="Waiting for telemetry"
            />

            <MarketSummaryCard
              eyebrow="Total Yield"
              value={energyValueLabel(data.kpis.totalYieldKwh)}
              valueUnit={data.kpis.totalYieldKwh !== null ? "kWh" : undefined}
              unavailableNote="Not available"
            />

            <MarketSummaryCard
              eyebrow="Consumption Today"
              value={energyValueLabel(data.kpis.consumedTodayKwh)}
              valueUnit={data.kpis.consumedTodayKwh !== null ? "kWh" : undefined}
              unavailableNote="Waiting for telemetry"
            />

            <MarketSummaryCard
              eyebrow="Consumed from PV"
              value={energyValueLabel(data.kpis.consumedFromPvKwh)}
              valueUnit={data.kpis.consumedFromPvKwh !== null ? "kWh" : undefined}
              unavailableNote="Waiting for telemetry"
            />

            <MarketSummaryCard
              eyebrow="Fed to Grid"
              value={energyValueLabel(data.kpis.exportedTodayKwh)}
              valueUnit={data.kpis.exportedTodayKwh !== null ? "kWh" : undefined}
              unavailableNote="Waiting for telemetry"
            />

            <MarketSummaryCard
              eyebrow="From Grid"
              value={energyValueLabel(data.kpis.importedTodayKwh)}
              valueUnit={data.kpis.importedTodayKwh !== null ? "kWh" : undefined}
              unavailableNote="Waiting for telemetry"
            />
          </section>

          <section className="grid gap-2.5 lg:grid-cols-[33%_1fr]">
            <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <div>
                <h2 className="text-sm font-semibold text-white">System Overview</h2>
                <p className="mt-0.5 text-xs text-slate-500">Real-time energy flow</p>
              </div>

              <div className="mt-2 min-h-0 flex-1">
                <EnergyFlowDiagram flow={data.energyFlow} />
              </div>
            </div>

            <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Live Energy</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Today&apos;s production, consumption, and grid exchange
                </p>
              </div>

              <div className="mt-2.5 h-[220px] sm:h-[280px] lg:h-[320px] xl:h-[360px]">
                <LiveEnergyChart data={data.chartSeries} nowAnnotation={data.nowAnnotation} />
              </div>
            </div>
          </section>

          <section className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4">
            <WeatherCard />
            <GlidepathCard />
            <DashboardMarketWidget market={data.market} />
            <MarketEventLog entries={data.eventLog} />
          </section>

          <section>
            <InvertersCard inverters={data.inverters} />
          </section>
        </>
      )}

      <p className="text-xs text-slate-500">
        Last telemetry:{" "}
        <span className="text-slate-300">
          {data.plantAvailable && data.latestTelemetryAt
            ? sofiaDateTimeLabel(data.latestTelemetryAt)
            : "No data"}
        </span>
      </p>
    </div>
  );
}
