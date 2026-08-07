import type { BatteryIntervalDiagnostic } from "@/lib/digital-twin/battery-diagnostics";

/**
 * Battery Digital Twin UI milestone - the "Show Battery Diagnostics"
 * developer toggle's content. Platform Admin only by construction: this
 * whole page (`app/admin/digital-twin/page.tsx`) already gates on
 * `requirePlatformAdmin()`, so no separate permission check belongs here -
 * the toggle is purely a show/hide affordance for detail that would
 * otherwise clutter the page. Every column is a direct field off
 * `BatteryIntervalDiagnostic` (`lib/digital-twin/battery-diagnostics.ts`'s
 * own already-computed output) - no calculation happens in this file.
 */
type Props = {
  diagnostics: BatteryIntervalDiagnostic[];
};

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Sofia",
  dateStyle: "short",
  timeStyle: "short",
});

const ACTION_COLOR_CLASS: Record<BatteryIntervalDiagnostic["action"], string> = {
  Idle: "text-white/50",
  "Charge from PV": "text-emerald-400",
  "Charge from Grid": "text-amber-400",
  Discharge: "text-blue-400",
  Export: "text-white/70",
  Curtailed: "text-rose-400",
};

export function BatteryDiagnosticsPanel({ diagnostics }: Props) {
  if (diagnostics.length === 0) {
    return <p className="text-sm text-white/50">No diagnostic intervals for this period.</p>;
  }

  return (
    <div className="max-h-[420px] overflow-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[720px] border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-[#0b1020] text-white/40">
          <tr>
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Available PV (kWh)</th>
            <th className="px-3 py-2 font-medium">Charge (kWh)</th>
            <th className="px-3 py-2 font-medium">Discharge (kWh)</th>
            <th className="px-3 py-2 font-medium">SOC (kWh)</th>
            <th className="px-3 py-2 font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {diagnostics.map((row) => (
            <tr key={row.intervalStart.toISOString()} className="text-white/70">
              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-white/50">
                {timeFormatter.format(row.intervalStart)}
              </td>
              <td className="px-3 py-1.5 tabular-nums">{row.availablePvKwh.toFixed(2)}</td>
              <td className="px-3 py-1.5 tabular-nums">{row.batteryChargeKwh.toFixed(2)}</td>
              <td className="px-3 py-1.5 tabular-nums">{row.batteryDischargeKwh.toFixed(2)}</td>
              <td className="px-3 py-1.5 tabular-nums">{row.socAfterKwh.toFixed(2)}</td>
              <td className={`px-3 py-1.5 font-medium ${ACTION_COLOR_CLASS[row.action]}`} title={row.reason}>
                {row.action}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
