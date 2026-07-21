import { requireOnboardedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { EnergyFlowDiagram } from "@/components/dashboard/EnergyFlowDiagram";
import { GlidepathCard } from "@/components/dashboard/GlidepathCard";
import { InvertersCard } from "@/components/dashboard/InvertersCard";
import { LiveEnergyChart } from "@/components/dashboard/LiveEnergyChart";
import { RefreshButton } from "@/components/dashboard/RefreshButton";
import { WeatherCard } from "@/components/dashboard/WeatherCard";
import { MarketEventLog } from "@/components/market/MarketEventLog";
import { MarketSummaryCard } from "@/components/market/MarketSummaryCard";
import { MarketToolbar } from "@/components/market/MarketToolbar";

import { getDashboardPageData } from "./dashboard-data";

export { pageHeading } from "./heading";

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
 *
 * ## Dashboard visual refinement (FINAL PASS) milestone
 *
 * System Overview + Live Energy now share one row (35%/65% split, identical
 * height via CSS Grid's default stretch). The Market card
 * (`DashboardMarketWidget`, since removed — Revenue/price already live on
 * Market) is gone from the bottom row without a replacement; Inverters
 * moved into that same row instead of its own full-width section below, so
 * the bottom row is now exactly four equal cards: Weather, Forecast,
 * Inverters, Event Log. `data.market` (still computed in
 * `dashboard-data.ts`, untouched per this milestone's "don't touch the data
 * layer" constraint) is simply no longer rendered anywhere on this page.
 *
 * ## Dashboard UI polish (FINAL) milestone
 *
 * Reuses Market's own `MarketToolbar` (a `basePath` prop was added to that
 * shared component so it can navigate `/dashboard` instead of always
 * `/market` — not a second toolbar) for real day navigation, backed by
 * `dashboard-data.ts` now accepting `selectedDateParam` exactly like
 * `getMarketPageData`/`getProductionPageData` already do. Bottom row
 * reordered to Inverters, Weather, Forecast, Event Log (card sizes
 * unchanged). Total Yield is the one KPI displayed in MWh instead of kWh
 * (`mwhValueLabel`) — every other KPI stays kWh.
 *
 * ## Dashboard UI final polish milestone
 *
 * "Waiting for telemetry" is honest for *today* (data is genuinely still
 * arriving) but misleading for a past day that simply has no stored row —
 * `unavailableNote` below picks friendlier, accurate wording for that case
 * ("Historical data not available", or a more specific variant matching
 * this milestone's examples) without ever hiding a real historical value
 * that *does* exist (every KPI here still just renders whatever
 * `dashboard-data.ts` returns — `null` only when a row is genuinely
 * absent, real historical rows render exactly like today's).
 *
 * ## Fixed Header Architecture milestone
 *
 * The eyebrow/title block that used to open this page's own JSX now
 * renders once inside `AppHeader` (via `PageHeading`, reading this page's
 * own `pageHeading` - see `./heading.ts`) instead of here - this page
 * starts directly with `MarketToolbar`.
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

/** Total Yield only — the one KPI shown in MWh instead of kWh, per this milestone's explicit formatting requirement. */
function mwhValueLabel(kwh: number | null): string | undefined {
  return kwh !== null ? (kwh / 1000).toFixed(1) : undefined;
}

/** Friendlier, date-aware unavailable wording — `todayNote` only ever applies when the selected day genuinely is today. */
function unavailableNote(
  isToday: boolean,
  todayNote: string,
  historicalNote: string,
): string {
  return isToday ? todayNote : historicalNote;
}

type DashboardPageProps = {
  searchParams: Promise<{ date?: string }>;
};

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const user = await requireOnboardedUser();
  const params = await searchParams;

  const automationSettings = await prisma.automationSettings.findUnique({
    where: { organizationId: user.organizationId },
  });

  const data = await getDashboardPageData(
    user.organizationId,
    automationSettings,
    params.date,
  );

  return (
    <div className="mr-auto max-w-7xl space-y-3">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <MarketToolbar
            basePath="/dashboard"
            selectedDate={data.selectedDate}
            prevDateParam={data.prevDateParam}
            nextDateParam={data.nextDateParam}
            isToday={data.isToday}
          />
        </div>

        <RefreshButton />
      </div>

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
              valueUnit={
                data.kpis.producedTodayKwh !== null ? "kWh" : undefined
              }
              unavailableNote={unavailableNote(
                data.isToday,
                "Waiting for telemetry",
                "No historical production data available",
              )}
            />

            <MarketSummaryCard
              eyebrow="Total Yield"
              value={mwhValueLabel(data.kpis.totalYieldKwh)}
              valueUnit={data.kpis.totalYieldKwh !== null ? "MWh" : undefined}
              unavailableNote={unavailableNote(
                data.isToday,
                "Not available",
                "Historical data not available",
              )}
            />

            <MarketSummaryCard
              eyebrow="Consumption Today"
              value={energyValueLabel(data.kpis.consumedTodayKwh)}
              valueUnit={
                data.kpis.consumedTodayKwh !== null ? "kWh" : undefined
              }
              unavailableNote={unavailableNote(
                data.isToday,
                "Waiting for telemetry",
                "Historical data not available",
              )}
            />

            <MarketSummaryCard
              eyebrow="Consumed from PV"
              value={energyValueLabel(data.kpis.consumedFromPvKwh)}
              valueUnit={
                data.kpis.consumedFromPvKwh !== null ? "kWh" : undefined
              }
              unavailableNote={unavailableNote(
                data.isToday,
                "Waiting for telemetry",
                "Historical data not available",
              )}
            />

            <MarketSummaryCard
              eyebrow="Fed to Grid"
              value={energyValueLabel(data.kpis.exportedTodayKwh)}
              valueUnit={
                data.kpis.exportedTodayKwh !== null ? "kWh" : undefined
              }
              unavailableNote={unavailableNote(
                data.isToday,
                "Waiting for telemetry",
                "Historical data not available",
              )}
            />

            <MarketSummaryCard
              eyebrow="From Grid"
              value={energyValueLabel(data.kpis.importedTodayKwh)}
              valueUnit={
                data.kpis.importedTodayKwh !== null ? "kWh" : undefined
              }
              unavailableNote={unavailableNote(
                data.isToday,
                "Waiting for telemetry",
                "Historical data not available",
              )}
            />
          </section>

          <section className="grid gap-2.5 lg:grid-cols-[30%_1fr]">
            <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  System Overview
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Real-time energy flow
                </p>
              </div>

              <div className="mt-2 min-h-0 flex-1">
                <EnergyFlowDiagram
                  flow={data.energyFlow}
                  isToday={data.isToday}
                />
              </div>
            </div>

            <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:p-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Live Energy
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Today&apos;s production, consumption, and grid exchange
                </p>
              </div>

              <div className="mt-2.5 h-[220px] sm:h-[280px] lg:h-[320px] xl:h-[360px]">
                <LiveEnergyChart
                  data={data.chartSeries}
                  nowAnnotation={data.nowAnnotation}
                />
              </div>
            </div>
          </section>

          <section className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4">
            <InvertersCard inverters={data.inverters} />
            <WeatherCard />
            <GlidepathCard />
            <MarketEventLog entries={data.eventLog} />
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
