import { requireOnboardedUser } from "@/lib/auth/session";
import {
  getPlantConfiguredExportControlMode,
  type ConfiguredExportControlMode,
} from "@/lib/fusionsolar/get-export-control-status";
import { prisma } from "@/lib/prisma";

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

  const latestTelemetry = plants
    .map((plant) => plant.telemetrySnapshots[0])
    .filter((telemetry) => telemetry !== undefined);

  const totalLifetimeEnergy = latestTelemetry.reduce(
    (sum, telemetry) => sum + Number(telemetry.totalPower?.toString() ?? 0),
    0,
  );

  const totalTodayEnergy = latestTelemetry.reduce(
    (sum, telemetry) => sum + Number(telemetry.dayPower?.toString() ?? 0),
    0,
  );

  const totalMonthEnergy = latestTelemetry.reduce(
    (sum, telemetry) => sum + Number(telemetry.monthPower?.toString() ?? 0),
    0,
  );

  const latestUpdate =
    latestTelemetry.length > 0
      ? new Date(
          Math.max(
            ...latestTelemetry.map((telemetry) =>
              telemetry.collectedAt.getTime(),
            ),
          ),
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
            const exportControl = exportControlByPlantId.get(plant.id) ?? null;
            const exportBadge = getExportControlModeBadge(exportControl);

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
                      <span className="h-2 w-2 rounded-full bg-cyan-400" />
                      Telemetry available
                    </div>

                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <span
                        className={`h-2 w-2 rounded-full ${exportBadge.colorClass}`}
                      />
                      {exportBadge.label}
                    </div>
                  </div>
                </div>

                <div className="grid gap-px bg-white/10 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    ["Today", telemetry?.dayPower, "kWh"],
                    ["This Month", telemetry?.monthPower, "kWh"],
                    ["Lifetime", telemetry?.totalPower, "kWh"],
                    ["Exported Today", telemetry?.dayOnGridEnergy, "kWh"],
                    ["Consumed Today", telemetry?.dayUseEnergy, "kWh"],
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
                </div>

                <div className="px-6 py-4 text-xs text-slate-500">
                  Last updated:{" "}
                  {telemetry
                    ? telemetry.collectedAt.toLocaleString()
                    : "No telemetry available"}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
