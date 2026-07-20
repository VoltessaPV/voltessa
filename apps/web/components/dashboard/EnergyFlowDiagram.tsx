import { Home, Sun, Zap } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import type { EnergyFlowState } from "@/app/(platform)/dashboard/dashboard-data";

type EnergyFlowDiagramProps = {
  flow: EnergyFlowState;
};

/**
 * Compact PV / Load / Grid triangle diagram (Dashboard UI Refinement — Final
 * Design Pass milestone), replacing the previous wide horizontal
 * PV -> Home -> Grid layout. Matches the Huawei-style layout the milestone
 * asked for: PV top-center, Load bottom-left, Grid bottom-right — icons
 * (`lucide-react`, already a dependency) instead of plain text circles.
 * "Load", never "Home" — this product isn't house-only.
 *
 * Exactly two states, never a third "idle" one, unchanged from the
 * original implementation (see `lib/telemetry/energy-flow.ts`'s
 * `deriveEnergyFlow` — this component still only renders what that
 * function returns, never modifies/clamps/floors a value itself):
 *
 * - Case A (`exporting`): PV -> Load -> Grid. The Load -> Grid segment
 *   flows outward (Load feeds Grid).
 * - Case B (`importing`): PV -> Load, Grid -> Load. The same segment
 *   reverses (Grid feeds Load).
 *
 * The PV -> Load segment always flows in one direction (down from PV)
 * regardless of state — only the Load <-> Grid segment's direction and
 * particle travel depend on `flow.direction`. Small glowing particles
 * travel along both segments via the same CSS motion-path technique
 * already established in `app/globals.css` (`voltessa-flow-particle`) —
 * reused, not reinvented.
 */
export function EnergyFlowDiagram({ flow }: EnergyFlowDiagramProps) {
  if (!flow.available) {
    return (
      <div className="flex h-[160px] items-center justify-center text-sm text-slate-500">
        Live meter data unavailable
      </div>
    );
  }

  const { pvKw, consumption, direction, gridKw } = flow;
  const importing = direction === "importing";

  // Coordinates share the same 0-100 x / 0-50 y space as the SVG viewBox
  // below, so the HTML icon nodes (positioned by percentage) and the SVG
  // lines/particles (positioned by these same numbers) always line up
  // regardless of the container's rendered size.
  const PV = { x: 50, y: 9 };
  const LOAD = { x: 14, y: 41 };
  const GRID = { x: 86, y: 41 };

  const pvToLoadPath = `M${PV.x},${PV.y} L${LOAD.x},${LOAD.y}`;
  const loadGridForwardPath = `M${LOAD.x},${LOAD.y} L${GRID.x},${GRID.y}`;
  const loadGridReversePath = `M${GRID.x},${GRID.y} L${LOAD.x},${LOAD.y}`;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative aspect-[2/1] w-full max-w-[360px]">
        <svg viewBox="0 0 100 50" className="absolute inset-0 h-full w-full" aria-hidden>
          <line
            x1={PV.x}
            y1={PV.y}
            x2={LOAD.x}
            y2={LOAD.y}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={0.6}
          />
          <line
            x1={LOAD.x}
            y1={LOAD.y}
            x2={GRID.x}
            y2={GRID.y}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={0.6}
          />

          {pvKw > 0 &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`pv-${delay}`}
                r={1}
                fill="#6ee7b7"
                className="voltessa-flow-particle"
                style={{ offsetPath: `path('${pvToLoadPath}')`, animationDelay: `${delay}s` }}
              />
            ))}

          {[0, 0.7, 1.4].map((delay) => (
            <circle
              key={`grid-${delay}`}
              r={1}
              fill="#67e8f9"
              className="voltessa-flow-particle"
              style={{
                offsetPath: `path('${importing ? loadGridReversePath : loadGridForwardPath}')`,
                animationDelay: `${delay}s`,
              }}
            />
          ))}
        </svg>

        <FlowNode
          icon={<Sun className="h-5 w-5 text-emerald-300" />}
          label="PV"
          value={`${pvKw.toFixed(1)} kW`}
          borderClass="border-emerald-400/40"
          style={{ left: `${PV.x}%`, top: `${PV.y * 2}%` }}
        />

        <FlowNode
          icon={<Home className="h-5 w-5 text-slate-200" />}
          label="Load"
          value={consumption.consistent ? `${consumption.kw.toFixed(1)} kW` : "Inconsistent"}
          borderClass={consumption.consistent ? "border-white/15" : "border-amber-400/40"}
          style={{ left: `${LOAD.x}%`, top: `${LOAD.y * 2}%` }}
        />

        <FlowNode
          icon={<Zap className="h-5 w-5 text-cyan-300" />}
          label="Grid"
          value={`${gridKw.toFixed(1)} kW`}
          borderClass="border-cyan-400/40"
          style={{ left: `${GRID.x}%`, top: `${GRID.y * 2}%` }}
        />
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className={`h-1.5 w-1.5 rounded-full ${importing ? "bg-cyan-400" : "bg-emerald-400"}`} />
        <span className="font-medium text-white">{importing ? "Importing" : "Exporting"}</span>
      </div>

      {!consumption.consistent && (
        <p className="max-w-md text-center text-xs text-amber-400/80">
          PV and grid readings are momentarily inconsistent — Load can&apos;t be derived right
          now. PV and Grid above are the real measured values, unmodified.
        </p>
      )}
    </div>
  );
}

function FlowNode({
  icon,
  label,
  value,
  borderClass,
  style,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  borderClass: string;
  style: CSSProperties;
}) {
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
      style={style}
    >
      <div
        className={`flex h-11 w-11 items-center justify-center rounded-full border bg-[#0f172a] ${borderClass}`}
      >
        {icon}
      </div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-xs font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}
