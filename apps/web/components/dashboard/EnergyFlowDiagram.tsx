import type { CSSProperties, ReactNode } from "react";

import type { EnergyFlowState } from "@/app/(platform)/dashboard/dashboard-data";
import { LoadBuildingIcon, SolarPanelIcon, TransmissionTowerIcon } from "@/components/dashboard/energy-icons";

type EnergyFlowDiagramProps = {
  flow: EnergyFlowState;
};

/**
 * Huawei-inspired PV / Load / Grid triangle diagram (Dashboard UI
 * Refinement — Final Design Pass, second iteration). Same three nodes as
 * the previous iteration (PV top, Load bottom-left, Grid bottom-right) and
 * the same domain input (`lib/telemetry/energy-flow.ts`'s `deriveEnergyFlow`
 * — unchanged, this component still never modifies/clamps/floors a value),
 * but the flow topology is corrected to match how the energy actually
 * moves:
 *
 * - **Case A (`exporting`, PV >= Load)**: PV splits into two independent
 *   flows — PV -> Load (serving all of Load) and PV -> Grid (the surplus,
 *   `gridKw`). There is no Load -> Grid edge active here.
 * - **Case B (`importing`, Load > PV)**: PV -> Load (all of PV, `pvKw`)
 *   and, separately, Grid -> Load (the shortfall, `gridKw`) — Grid feeds
 *   Load directly, never via PV.
 *
 * Never a `PV -> Load -> Grid` chain. All three edges of the triangle are
 * always drawn (matching a real Huawei-style diagram, which shows every
 * physical connection), but only the two relevant to the current
 * direction are "active" (colored, particled) — the third is rendered
 * subtle/inactive, per this milestone's explicit requirement. Which edge
 * is active depends only on `flow.direction` (a real, always-defined
 * meter reading), never on `consumption.consistent` — the Load node's own
 * displayed number is the only thing gated on that.
 *
 * Edge values reuse the exact same `flow` fields the previous iteration
 * already displayed at the nodes (`pvKw`, `gridKw`, `consumption.kw`) —
 * no new calculation. By the same energy-balance identity
 * `deriveEnergyFlow` already encodes: exporting means
 * `pvKw = consumption.kw + gridKw` (Load's share plus the export), and
 * importing means `consumption.kw = pvKw + gridKw` (PV's share plus the
 * import) — this component only decides which edge shows which
 * already-computed number, purely a presentation choice.
 */
export function EnergyFlowDiagram({ flow }: EnergyFlowDiagramProps) {
  if (!flow.available) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-slate-500">
        Live meter data unavailable
      </div>
    );
  }

  const { pvKw, consumption, direction, gridKw } = flow;
  const importing = direction === "importing";

  const loadKw = consumption.consistent ? consumption.kw : null;

  // Coordinates share the same 0-100 x / 0-90 y space as the SVG viewBox
  // below, so the HTML icon nodes (positioned by percentage) and the SVG
  // lines/particles (positioned by these same numbers) always line up
  // regardless of the container's rendered size. Taller than the previous
  // iteration's 2:1 box — this diagram now lives in a narrower, taller
  // column next to Live Energy, and a taller layout uses that space
  // better while keeping the nodes (not empty space) the visual focus.
  const PV = { x: 50, y: 12 };
  const LOAD = { x: 15, y: 78 };
  const GRID = { x: 85, y: 78 };

  const pvLoadPath = `M${PV.x},${PV.y} L${LOAD.x},${LOAD.y}`;
  const pvGridPath = `M${PV.x},${PV.y} L${GRID.x},${GRID.y}`;
  const gridLoadPath = `M${GRID.x},${GRID.y} L${LOAD.x},${LOAD.y}`;

  const pvLoadActive = pvKw > 0;
  const secondEdgeActive = gridKw > 0;
  // Exporting: PV -> Grid is the second active edge. Importing: Grid -> Load is.
  const pvGridActive = !importing && secondEdgeActive;
  const gridLoadActive = importing && secondEdgeActive;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="relative aspect-[10/9] w-full max-w-[240px]">
        <svg viewBox="0 0 100 90" className="absolute inset-0 h-full w-full" aria-hidden>
          {/* Every physical connection is always drawn — a real Huawei-style
              diagram shows all three edges, only the currently active ones
              are highlighted. */}
          <path
            d={pvLoadPath}
            stroke={pvLoadActive ? "#34d399" : "rgba(255,255,255,0.08)"}
            strokeWidth={pvLoadActive ? 0.7 : 0.5}
            fill="none"
          />
          <path
            d={pvGridPath}
            stroke={pvGridActive ? "#34d399" : "rgba(255,255,255,0.08)"}
            strokeWidth={pvGridActive ? 0.7 : 0.5}
            fill="none"
          />
          <path
            d={gridLoadPath}
            stroke={gridLoadActive ? "#67e8f9" : "rgba(255,255,255,0.08)"}
            strokeWidth={gridLoadActive ? 0.7 : 0.5}
            fill="none"
          />

          {pvLoadActive &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`pv-load-${delay}`}
                r={1}
                fill="#6ee7b7"
                className="voltessa-flow-particle"
                style={{ offsetPath: `path('${pvLoadPath}')`, animationDelay: `${delay}s` }}
              />
            ))}

          {pvGridActive &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`pv-grid-${delay}`}
                r={1}
                fill="#6ee7b7"
                className="voltessa-flow-particle"
                style={{ offsetPath: `path('${pvGridPath}')`, animationDelay: `${delay}s` }}
              />
            ))}

          {gridLoadActive &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`grid-load-${delay}`}
                r={1}
                fill="#67e8f9"
                className="voltessa-flow-particle"
                style={{ offsetPath: `path('${gridLoadPath}')`, animationDelay: `${delay}s` }}
              />
            ))}
        </svg>

        <FlowNode
          icon={<SolarPanelIcon className="h-6 w-6 text-emerald-300" />}
          label="PV"
          value={`${pvKw.toFixed(1)} kW`}
          borderClass="border-emerald-400/40"
          style={{ left: `${PV.x}%`, top: `${(PV.y / 90) * 100}%` }}
        />

        <FlowNode
          icon={<LoadBuildingIcon className="h-6 w-6 text-slate-200" />}
          label="Load"
          value={loadKw !== null ? `${loadKw.toFixed(1)} kW` : "Inconsistent"}
          borderClass={loadKw !== null ? "border-white/15" : "border-amber-400/40"}
          style={{ left: `${LOAD.x}%`, top: `${(LOAD.y / 90) * 100}%` }}
        />

        <FlowNode
          icon={<TransmissionTowerIcon className="h-6 w-6 text-cyan-300" />}
          label="Grid"
          value={`${gridKw.toFixed(1)} kW`}
          borderClass="border-cyan-400/40"
          style={{ left: `${GRID.x}%`, top: `${(GRID.y / 90) * 100}%` }}
        />
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className={`h-1.5 w-1.5 rounded-full ${importing ? "bg-cyan-400" : "bg-emerald-400"}`} />
        <span className="font-medium text-white">{importing ? "Importing" : "Exporting"}</span>
      </div>

      {loadKw === null && (
        <p className="max-w-[220px] text-center text-xs text-amber-400/80">
          PV and grid readings are momentarily inconsistent — Load can&apos;t be derived right
          now.
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
        className={`flex h-12 w-12 items-center justify-center rounded-full border bg-[#0f172a] ${borderClass}`}
      >
        {icon}
      </div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-xs font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}
