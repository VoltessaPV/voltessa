import { Cpu } from "lucide-react";
import { useTranslations } from "next-intl";

import type { InverterStatusResult } from "@/lib/fusionsolar/get-plant-inverter-status";

type InvertersCardProps = {
  inverters: InverterStatusResult;
  /** Whether the automation engine currently has this plant in Zero Export mode - shown as a small, subtle header badge only when true; omitted (not a "No" state) otherwise. */
  zeroExportActive?: boolean;
};

const STATUS_DOT_CLASS: Record<string, string> = {
  green: "bg-emerald-400",
  yellow: "bg-amber-400",
  red: "bg-red-400",
  gray: "bg-slate-500",
};

/**
 * Every inverter shown individually — never aggregated into one number —
 * one compact row per inverter (Design-System Consistency milestone):
 * status dot, name, current power. The dot's color already represents
 * online state (green = online/producing, gray = offline/no data, per
 * `get-plant-inverter-status.ts`'s classification).
 *
 * Existing-Data Completeness milestone: each row now also shows the
 * inverter's real operating-state text (translated from `statusKey` —
 * `classifyInverterState`'s already-computed classification, previously
 * only used for the dot's color) and its real internal temperature
 * (`DeviceTelemetry.temperature`, already fetched for this exact card,
 * previously never read) — no new query, no new widget, same one row per
 * inverter.
 */
export function InvertersCard({ inverters, zeroExportActive }: InvertersCardProps) {
  const t = useTranslations("dashboard.inverters");
  const tStatus = useTranslations("dashboard.inverters.status");
  const tTerm = useTranslations("terminology");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          <Cpu className="h-3.5 w-3.5" />
          {t("title")}
        </p>

        {zeroExportActive && (
          <span className="flex items-center gap-1 text-[10px] text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            {tTerm("zeroExport")}
          </span>
        )}
      </div>

      {!inverters.available ? (
        <p className="mt-4 text-xs text-slate-500">
          {inverters.reason === "no_inverter_devices"
            ? t("noInverterDevices")
            : inverters.reason === "historical_day"
              ? t("historicalUnavailable")
              : t("dataUnavailable")}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/5">
          {inverters.inverters.map((inverter) => (
            <li key={inverter.deviceId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[inverter.statusColor]}`} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{inverter.name}</p>
                  <p className="truncate text-[11px] text-slate-500">{tStatus(inverter.statusKey)}</p>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-sm font-medium tabular-nums text-white">
                  {inverter.powerKw !== null ? `${inverter.powerKw.toFixed(1)} kW` : "—"}
                </p>
                <p className="text-[11px] tabular-nums text-slate-500">
                  {inverter.temperatureC !== null ? `${inverter.temperatureC.toFixed(1)}°C` : "—"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
