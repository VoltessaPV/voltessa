import type { CSSProperties, ReactNode } from "react";

import type { EnergyFlowState } from "@/app/(platform)/dashboard/dashboard-data";
import { LoadBuildingIcon, SolarPanelIcon, TransmissionTowerIcon } from "@/components/dashboard/energy-icons";

type EnergyFlowDiagramProps = {
  flow: EnergyFlowState;
};

/**
 * Huawei-style PV / Load / Grid diagram (Dashboard visual refinement, FINAL
 * PASS). Topology, per this milestone's explicit geometry requirement: a
 * double vertical line drops straight down from PV to a single junction,
 * which then splits exactly once into a horizontal bus — Load at its left
 * end, Grid at its right end, no further vertical drops after the split.
 * Same domain input as every prior iteration
 * (`lib/telemetry/energy-flow.ts`'s `deriveEnergyFlow`, unchanged) — this
 * component still only decides how to color/animate the two halves of the
 * bus, never a new calculation.
 *
 * - **Exporting**: the trunk and both bus halves are green — PV's output
 *   splits at the junction, part staying left to Load, part continuing
 *   right to Grid.
 * - **Importing**: the trunk stays green (PV is still contributing what it
 *   can), but the whole bus turns red/orange and animates right-to-left
 *   (Grid, through the junction, to Load) — Grid supplying the shortfall.
 *   Never both colors on the bus at once.
 * - Whenever `gridKw` is genuinely `0` (no real export or import
 *   happening), the bus renders as a plain, static, light-grey line
 *   instead of inventing a direction for a flow that isn't there.
 *
 * Nodes are deliberately light — small, thin low-opacity borders, no glow —
 * so the flow lines (not the nodes) read as the dominant visual element,
 * per this milestone's explicit ask. Icons are custom energy-asset
 * illustrations (`energy-icons.tsx`): a solar panel, a building, a
 * transmission tower — never a generic sun/lightning-bolt/home glyph.
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
  // lines/particles (positioned by these same numbers) always line up.
  const PV = { x: 50, y: 10 };
  const JUNCTION = { x: 50, y: 55 };
  const LOAD = { x: 12, y: 55 };
  const GRID = { x: 88, y: 55 };

  const trunkActive = pvKw > 0;
  const busActive = gridKw > 0;

  const leftBusPath = `M${JUNCTION.x},${JUNCTION.y} L${LOAD.x},${LOAD.y}`;
  const rightBusPath = `M${JUNCTION.x},${JUNCTION.y} L${GRID.x},${GRID.y}`;
  const wholeBusPath = `M${GRID.x},${GRID.y} L${LOAD.x},${LOAD.y}`;

  const busColor = !busActive ? "rgba(255,255,255,0.1)" : importing ? "#fb923c" : "#34d399";
  const trunkColor = trunkActive ? "#34d399" : "rgba(255,255,255,0.1)";
  const particleColor = importing ? "#fdba74" : "#6ee7b7";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="relative aspect-[10/9] w-full max-w-[230px]">
        <svg viewBox="0 0 100 90" className="absolute inset-0 h-full w-full" aria-hidden>
          {/* Double vertical trunk, PV -> junction */}
          <line x1={PV.x - 1.4} y1={PV.y + 6} x2={JUNCTION.x - 1.4} y2={JUNCTION.y} stroke={trunkColor} strokeWidth={0.6} />
          <line x1={PV.x + 1.4} y1={PV.y + 6} x2={JUNCTION.x + 1.4} y2={JUNCTION.y} stroke={trunkColor} strokeWidth={0.6} />

          {/* Horizontal bus, junction splits once into Load (left) and Grid (right) */}
          <path d={leftBusPath} stroke={busColor} strokeWidth={busActive ? 0.7 : 0.5} fill="none" />
          <path d={rightBusPath} stroke={busColor} strokeWidth={busActive ? 0.7 : 0.5} fill="none" />

          {trunkActive &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`trunk-${delay}`}
                r={0.9}
                fill="#6ee7b7"
                className="voltessa-flow-particle"
                style={{
                  offsetPath: `path('M${PV.x},${PV.y + 6} L${JUNCTION.x},${JUNCTION.y}')`,
                  animationDelay: `${delay}s`,
                }}
              />
            ))}

          {busActive && !importing &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`bus-left-${delay}`}
                r={0.9}
                fill={particleColor}
                className="voltessa-flow-particle"
                style={{ offsetPath: `path('${leftBusPath}')`, animationDelay: `${delay}s` }}
              />
            ))}

          {busActive && !importing &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`bus-right-${delay}`}
                r={0.9}
                fill={particleColor}
                className="voltessa-flow-particle"
                style={{ offsetPath: `path('${rightBusPath}')`, animationDelay: `${delay}s` }}
              />
            ))}

          {busActive && importing &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`bus-import-${delay}`}
                r={0.9}
                fill={particleColor}
                className="voltessa-flow-particle"
                style={{ offsetPath: `path('${wholeBusPath}')`, animationDelay: `${delay}s` }}
              />
            ))}
        </svg>

        <FlowNode
          icon={<SolarPanelIcon className="h-5 w-5 text-emerald-300/90" />}
          label="PV"
          value={`${pvKw.toFixed(1)} kW`}
          borderClass="border-white/10"
          style={{ left: `${PV.x}%`, top: `${(PV.y / 90) * 100}%` }}
        />

        <FlowNode
          icon={<LoadBuildingIcon className="h-5 w-5 text-slate-300" />}
          label="Load"
          value={loadKw !== null ? `${loadKw.toFixed(1)} kW` : "Inconsistent"}
          borderClass="border-white/10"
          style={{ left: `${LOAD.x}%`, top: `${(LOAD.y / 90) * 100}%` }}
        />

        <FlowNode
          icon={<TransmissionTowerIcon className="h-5 w-5 text-cyan-300/90" />}
          label="Grid"
          value={`${gridKw.toFixed(1)} kW`}
          borderClass="border-white/10"
          style={{ left: `${GRID.x}%`, top: `${(GRID.y / 90) * 100}%` }}
        />
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className={`h-1.5 w-1.5 rounded-full ${importing ? "bg-orange-400" : "bg-emerald-400"}`} />
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
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
      style={style}
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full border bg-[#0f172a]/80 ${borderClass}`}
      >
        {icon}
      </div>
      <p className="text-[9px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-[11px] font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}
