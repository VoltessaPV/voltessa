import { resolveExportThreshold } from "@/lib/automation/export-threshold-config";
import { requireOnboardedUser } from "@/lib/auth/session";
import {
  getPlantConfiguredExportControlMode,
  type ConfiguredExportControlMode,
} from "@/lib/fusionsolar/get-export-control-status";
import {
  getPlantCurrentPowerStatus,
  type PlantPowerStatus,
} from "@/lib/fusionsolar/get-plant-power-status";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import { getMarketPriceStatus } from "@/lib/market-price/status";
import { localDayBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";
import { computePlantEnergyMetrics } from "@/lib/telemetry/energy-metrics";

/**
 * Per the Telemetry Consumer Migration milestone (ADR-007,
 * docs/research/telemetry-platform-foundation.md): every FusionSolar read
 * on this page is one of two explicit categories.
 *
 * - **Category A — real-time operational state, still a live Huawei
 *   read**: `getPlantConfiguredExportControlMode` (the configured
 *   export-control badge) and `getPlantCurrentPowerStatus` (the "Current
 *   Power" card — reused as-is from `market/production-data.ts`, no new
 *   Huawei call introduced). No historical equivalent exists to read
 *   instead — both describe "right now."
 * - **Category B — historical/trend data, now DeviceTelemetry-only**:
 *   Today's production/exported/imported energy, and the "Last telemetry"
 *   timestamp, all come from `lib/telemetry/energy-metrics.ts` — no
 *   Huawei call, no FusionSolar connection needed. "This Month"/"Lifetime"
 *   still read the older `PlantTelemetrySnapshot` table (itself already a
 *   Postgres read, not a live Huawei call) because DeviceTelemetry has no
 *   monthly/lifetime data yet — only today+yesterday have been bootstrapped
 *   (see the telemetry foundation milestone) — not because they're
 *   Category A.
 */

/**
 * Reflects ONLY the plant's configured export-control mode
 * (getPlantConfiguredExportControlMode). Deliberately does not fall back to
 * inverter_state or any other telemetry-derived signal when unavailable —
 * see lib/fusionsolar/get-export-control-status.ts for why those are not
 * interchangeable. If this data is ever unavailable, that must be shown
 * explicitly, not inferred from something else.
 */
function getExportControlModeBadge(
  status: ConfiguredExportControlMode | null,
): {
  label: string;
  colorClass: string;
} {
  if (!status || !status.available) {
    return {
      label: "Configured export control unavailable",
      colorClass: "bg-slate-500",
    };
  }

  switch (status.mode.activePowerControlMode) {
    case "noLimit":
      return { label: "No Export Limit", colorClass: "bg-emerald-400" };
    case "zeroExportLimitation":
      return { label: "Zero Export", colorClass: "bg-red-400" };
    case "limitedPowerGridKW":
      return {
        label: `Limited to ${status.mode.limitedPowerGridValueParam.maxGridFeedInPowerValue} kW`,
        colorClass: "bg-amber-400",
      };
    case "limitedPowerGridPercent":
      return {
        label: `Limited to ${status.mode.limitedPowerGridPercentParam.maxGridFeedInPowerPercent}%`,
        colorClass: "bg-amber-400",
      };
    default:
      return { label: "Export Mode: Other", colorClass: "bg-slate-400" };
  }
}

function sofiaTimeLabel(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEnergy(value: { toString(): string } | null | undefined) {
  if (value == null) {
    return "—";
  }

  const numericValue = Number(value.toString());

  if (!Number.isFinite(numericValue)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(numericValue);
}

export default async function DashboardPage() {
  const user = await requireOnboardedUser();

  const plants = await prisma.plant.findMany({
    where: {
      organizationId: user.organizationId,
    },
    include: {
      telemetrySnapshots: {
        orderBy: {
          collectedAt: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: user.organizationId,
        provider: "HuaweiFusionSolar",
      },
    },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      tokenType: true,
      scope: true,
      expiresAt: true,
    },
  });

  // Category B — DeviceTelemetry only, never depends on `connection`.
  const telemetryEntries = await Promise.all(
    plants.map(async (plant) => {
      const { start: dayStart } = localDayBoundsUtc(
        new Date(),
        plant.timezone,
      );
      const metrics = await computePlantEnergyMetrics(
        plant.id,
        dayStart,
        new Date(),
      );

      return [plant.id, metrics] as const;
    }),
  );
  const telemetryByPlantId = new Map(telemetryEntries);

  // Category A — real-time operational state, still a live Huawei read.
  const exportControlEntries = await Promise.all(
    plants.map(async (plant) => {
      if (!connection || !plant.plantCode) {
        return [plant.id, null] as const;
      }

      try {
        const status = await getPlantConfiguredExportControlMode(
          connection,
          plant.plantCode,
        );

        return [plant.id, status] as const;
      } catch (error) {
        // Never let an unexpected FusionSolar error break the dashboard —
        // degrade to "unavailable" and log for operators. Not a fallback
        // to another data source — just an explicit "unavailable" render.
        console.error(
          "[Dashboard] Configured export control mode failed unexpectedly",
          {
            plantId: plant.id,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          },
        );

        return [plant.id, null] as const;
      }
    }),
  );

  const exportControlByPlantId = new Map(exportControlEntries);

  // Category A — real-time operational state, still a live Huawei read.
  // Same function Market's production-data.ts uses; degrades to an
  // explicit unavailable state per device type rather than ever falling
  // back to a stale DeviceTelemetry sample ("current power" must mean now).
  const powerStatusEntries = await Promise.all(
    plants.map(async (plant) => {
      if (!connection) {
        return [plant.id, null] as const;
      }

      const [inverters, meters] = await Promise.all([
        prisma.device.findMany({
          where: { plantId: plant.id, devTypeId: 1 },
          select: { huaweiDeviceId: true },
        }),
        prisma.device.findMany({
          where: { plantId: plant.id, devTypeId: 47 },
          select: { huaweiDeviceId: true },
        }),
      ]);

      try {
        const status = await getPlantCurrentPowerStatus(connection, {
          inverters,
          meters,
        });

        return [plant.id, status] as const;
      } catch (error) {
        console.error(
          "[Dashboard] Current power status failed unexpectedly",
          {
            plantId: plant.id,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          },
        );

        return [plant.id, null] as const;
      }
    }),
  );

  const powerStatusByPlantId = new Map<string, PlantPowerStatus | null>(
    powerStatusEntries,
  );

  const [currentMarketPrice, dayAheadMarketPrices, marketImportStatus, automationSettings] =
    await Promise.all([
      dbMarketPriceProvider.getCurrentPrice(),
      dbMarketPriceProvider.getDayAheadPrices(),
      dbMarketPriceProvider.getLatestImportStatus(),
      prisma.automationSettings.findUnique({
        where: { organizationId: user.organizationId },
      }),
    ]);

  const marketPriceStatus = getMarketPriceStatus(currentMarketPrice);

  const nextIntervalPrice =
    currentMarketPrice.available && dayAheadMarketPrices.available
      ? (dayAheadMarketPrices.prices.find(
          (price) =>
            price.timestamp.getTime() >
            currentMarketPrice.price.timestamp.getTime(),
        ) ?? null)
      : null;

  const lowestPriceToday = dayAheadMarketPrices.available
    ? dayAheadMarketPrices.prices.reduce((lowest, price) =>
        price.price < lowest.price ? price : lowest,
      )
    : null;

  const highestPriceToday = dayAheadMarketPrices.available
    ? dayAheadMarketPrices.prices.reduce((highest, price) =>
        price.price > highest.price ? price : highest,
      )
    : null;

  const exportThreshold = resolveExportThreshold(automationSettings);

  // "This Month"/"Lifetime" still read PlantTelemetrySnapshot — DeviceTelemetry
  // has no monthly/lifetime data yet (see the module doc comment above).
  const latestSnapshots = plants
    .map((plant) => plant.telemetrySnapshots[0])
    .filter((telemetry) => telemetry !== undefined);

  const totalLifetimeEnergy = latestSnapshots.reduce(
    (sum, telemetry) => sum + Number(telemetry.totalPower?.toString() ?? 0),
    0,
  );

  const totalMonthEnergy = latestSnapshots.reduce(
    (sum, telemetry) => sum + Number(telemetry.monthPower?.toString() ?? 0),
    0,
  );

  // "Energy Today" and "Last telemetry" now come from DeviceTelemetry —
  // the fresher, device-level source of truth (see ADR-007).
  const telemetryMetricsList = [...telemetryByPlantId.values()];

  const totalTodayEnergy = telemetryMetricsList.reduce(
    (sum, metrics) => sum + metrics.producedKwh,
    0,
  );

  const latestSampleTimestamps = telemetryMetricsList
    .map((metrics) => metrics.latestSampleAt)
    .filter((timestamp): timestamp is Date => timestamp !== null);

  const latestUpdate =
    latestSampleTimestamps.length > 0
      ? new Date(
          Math.max(...latestSampleTimestamps.map((timestamp) => timestamp.getTime())),
        )
      : null;

  const kpis = [
    {
      label: "Plants",
      value: plants.length.toString(),
      unit: "connected",
    },
    {
      label: "Energy Today",
      value: formatEnergy({ toString: () => totalTodayEnergy.toString() }),
      unit: "kWh",
    },
    {
      label: "Energy This Month",
      value: formatEnergy({ toString: () => totalMonthEnergy.toString() }),
      unit: "kWh",
    },
    {
      label: "Lifetime Energy",
      value: formatEnergy({ toString: () => totalLifetimeEnergy.toString() }),
      unit: "kWh",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section>
        <p className="text-sm font-medium text-cyan-400">Portfolio overview</p>

        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Dashboard
            </h1>

            <p className="mt-2 text-sm text-slate-400">
              Live operational overview for {user.organization?.name}
            </p>
          </div>

          <p className="text-sm text-slate-500">
            Last telemetry:{" "}
            <span className="text-slate-300">
              {latestUpdate ? latestUpdate.toLocaleString() : "No data"}
            </span>
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-sm"
          >
            <p className="text-sm text-slate-400">{kpi.label}</p>

            <div className="mt-4 flex items-baseline gap-2">
              <p className="text-2xl font-semibold tracking-tight text-white">
                {kpi.value}
              </p>

              <span className="text-xs text-slate-500">{kpi.unit}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Bulgarian Day-Ahead Market
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Data source: ENTSO-E
            </p>
          </div>

          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span
              className={`h-2 w-2 rounded-full ${marketPriceStatus.colorClass}`}
            />
            {marketPriceStatus.label}
          </div>
        </div>

        {marketImportStatus.available && marketImportStatus.isPartial && (
          <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Latest import is partial: {marketImportStatus.importedIntervals}/
            {marketImportStatus.expectedIntervals} intervals available (
            {marketImportStatus.missingIntervalsCount} missing from
            ENTSO-E). Missing intervals are not shown — never fabricated or
            interpolated.
          </p>
        )}

        <div className="mt-6 grid gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-2 xl:grid-cols-5">
          <div className="bg-[#080c1a] p-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Current Hour
            </p>
            <p className="mt-3 text-lg font-medium text-white">
              {currentMarketPrice.available
                ? `${currentMarketPrice.price.price} ${currentMarketPrice.price.currency}/MWh`
                : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {currentMarketPrice.available
                ? `From ${currentMarketPrice.price.timestamp.toLocaleTimeString("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit" })} (Europe/Sofia)`
                : marketPriceStatus.detail}
            </p>
          </div>

          <div className="bg-[#080c1a] p-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Next Hour Price
            </p>
            <p className="mt-3 text-lg font-medium text-white">
              {nextIntervalPrice
                ? `${nextIntervalPrice.price} ${nextIntervalPrice.currency}/MWh`
                : "—"}
            </p>
          </div>

          <div className="bg-[#080c1a] p-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Lowest Today
            </p>
            <p className="mt-3 text-lg font-medium text-white">
              {lowestPriceToday
                ? `${lowestPriceToday.price} ${lowestPriceToday.currency}/MWh`
                : "—"}
            </p>
          </div>

          <div className="bg-[#080c1a] p-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Highest Today
            </p>
            <p className="mt-3 text-lg font-medium text-white">
              {highestPriceToday
                ? `${highestPriceToday.price} ${highestPriceToday.currency}/MWh`
                : "—"}
            </p>
          </div>

          <div className="bg-[#080c1a] p-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Export Threshold
            </p>
            <p className="mt-3 text-lg font-medium text-white">
              {exportThreshold.minimumExportPrice} {exportThreshold.currency}
              /MWh
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Last successful update:{" "}
          {marketImportStatus.available
            ? marketImportStatus.importedAt.toLocaleString()
            : "No import has run yet"}
        </p>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Plants</h2>

          <p className="mt-1 text-sm text-slate-500">
            Latest stored FusionSolar telemetry
          </p>
        </div>

        <div className="space-y-4">
          {plants.map((plant) => {
            const telemetry = plant.telemetrySnapshots[0];
            const metrics = telemetryByPlantId.get(plant.id);
            const exportControl = exportControlByPlantId.get(plant.id) ?? null;
            const exportBadge = getExportControlModeBadge(exportControl);
            const powerStatus = powerStatusByPlantId.get(plant.id) ?? null;

            const lastUpdatedLabel = metrics?.latestSampleAt
              ? metrics.latestSampleAt.toLocaleString()
              : telemetry
                ? telemetry.collectedAt.toLocaleString()
                : "No telemetry available";

            return (
              <article
                key={plant.id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
              >
                <div className="flex flex-col gap-3 border-b border-white/10 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {plant.name}
                    </h3>

                    <p className="mt-1 text-sm text-slate-500">
                      {plant.vendor}
                      {plant.city ? ` · ${plant.city}` : ""}
                    </p>
                  </div>

                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <span
                        className={`h-2 w-2 rounded-full ${metrics?.available ? "bg-cyan-400" : "bg-slate-500"}`}
                      />
                      {metrics?.available
                        ? "Telemetry available"
                        : "No telemetry for today yet"}
                    </div>

                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <span
                        className={`h-2 w-2 rounded-full ${exportBadge.colorClass}`}
                      />
                      {exportBadge.label}
                    </div>
                  </div>
                </div>

                <div className="grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                  {[
                    ["Today", metrics?.available ? metrics.producedKwh : null, "kWh"],
                    ["This Month", telemetry?.monthPower, "kWh"],
                    ["Lifetime", telemetry?.totalPower, "kWh"],
                    ["Exported Today", metrics?.available ? metrics.exportedKwh : null, "kWh"],
                    ["Imported Today", metrics?.available ? metrics.importedKwh : null, "kWh"],
                  ].map(([label, value, unit]) => (
                    <div key={label?.toString()} className="bg-[#080c1a] p-5">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        {label?.toString()}
                      </p>

                      <p className="mt-3 text-lg font-medium text-white">
                        {formatEnergy(
                          value as { toString(): string } | null | undefined,
                        )}{" "}
                        <span className="text-xs font-normal text-slate-500">
                          {unit?.toString()}
                        </span>
                      </p>
                    </div>
                  ))}

                  <div className="bg-[#080c1a] p-5">
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Peak Production
                    </p>
                    <p className="mt-3 text-lg font-medium text-white">
                      {metrics?.available && metrics.peakProduction
                        ? metrics.peakProduction.kw
                        : "—"}{" "}
                      <span className="text-xs font-normal text-slate-500">
                        kW
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {metrics?.available && metrics.peakProduction
                        ? `at ${sofiaTimeLabel(metrics.peakProduction.timestamp)}`
                        : "No production yet today"}
                    </p>
                  </div>

                  <div className="bg-[#080c1a] p-5">
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Current Power
                    </p>
                    <p className="mt-3 text-lg font-medium text-white">
                      {powerStatus?.currentProduction.available
                        ? powerStatus.currentProduction.kw
                        : "—"}{" "}
                      <span className="text-xs font-normal text-slate-500">
                        kW
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {powerStatus?.currentExport.available &&
                      powerStatus.currentExport.kw > 0
                        ? `Exporting ${powerStatus.currentExport.kw} kW`
                        : powerStatus?.currentImport.available &&
                            powerStatus.currentImport.kw > 0
                          ? `Importing ${powerStatus.currentImport.kw} kW`
                          : powerStatus?.currentProduction.available
                            ? "No grid exchange"
                            : "FusionSolar data unavailable"}
                    </p>
                  </div>
                </div>

                <div className="px-6 py-4 text-xs text-slate-500">
                  Last updated: {lastUpdatedLabel}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
