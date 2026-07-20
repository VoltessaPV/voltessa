import { Cpu } from "lucide-react";

import type { InverterStatusResult } from "@/lib/fusionsolar/get-plant-inverter-status";

type InvertersCardProps = {
  inverters: InverterStatusResult;
};

const STATUS_DOT_CLASS: Record<string, string> = {
  green: "bg-emerald-400",
  yellow: "bg-amber-400",
  red: "bg-red-400",
  gray: "bg-slate-500",
};

/**
 * Every inverter shown individually — never aggregated into one number —
 * simplified to one compact row per inverter (Design-System Consistency
 * milestone): status dot, name, current power. No "Online · Grid-
 * connected" subtitle — the dot's color already represents online state
 * (green = online/producing, gray = offline/no data, per
 * `get-plant-inverter-status.ts`'s classification), so a redundant text
 * label next to it repeated the same fact twice.
 */
export function InvertersCard({ inverters }: InvertersCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
        <Cpu className="h-3.5 w-3.5" />
        Inverters
      </p>

      {!inverters.available ? (
        <p className="mt-4 text-xs text-slate-500">
          {inverters.reason === "no_inverter_devices"
            ? "No inverter devices configured"
            : "FusionSolar data unavailable"}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/5">
          {inverters.inverters.map((inverter) => (
            <li key={inverter.deviceId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[inverter.statusColor]}`} />
                <p className="truncate text-sm font-medium text-white">{inverter.name}</p>
              </div>

              <p className="shrink-0 text-sm font-medium tabular-nums text-white">
                {inverter.powerKw !== null ? `${inverter.powerKw.toFixed(1)} kW` : "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
