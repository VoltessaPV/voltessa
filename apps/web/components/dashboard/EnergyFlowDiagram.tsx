import type { CSSProperties, ReactNode } from "react";

import type { EnergyFlowState } from "@/app/(platform)/dashboard/dashboard-data";
import { LoadBuildingIcon, SolarPanelIcon, TransmissionTowerIcon } from "@/components/dashboard/energy-icons";

type EnergyFlowDiagramProps = {
  flow: EnergyFlowState;
};

/**
 * Huawei-style PV / Load / Grid diagram (Dashboard visual refinement,
 * final pass). Same domain input as every prior iteration
 * (`lib/telemetry/energy-flow.ts`'s `deriveEnergyFlow`, unchanged) — this
 * component only decides how to color/animate lines, never a new
 * calculation.
 *
 * Topology (three genuinely independent lines, never a chain):
 * - A double vertical line drops from PV straight down to a single split
 *   point, which then turns exactly once — one branch running left to
 *   Load, one running right to Grid. No further vertical drops after the
 *   split; each branch ends directly at its node.
 * - A completely separate horizontal line connects Load and Grid, drawn
 *   below the PV branches — this is the ONLY line ever used for
 *   Grid -> Load. It never coincides with, and is never the same segment
 *   as, the PV -> Load / PV -> Grid branches above it.
 *
 * Both nodes sit between their own PV branch (above) and the Load-Grid
 * line (below) — centered on the same x as both, per this milestone's
 * explicit alignment requirement.
 *
 * - **Exporting** (PV > Load): PV -> Load and PV -> Grid are the two
 *   active, green, particled flows (both originating from the PV split).
 *   The Load-Grid line stays a static, very light grey, dashed, never
 *   animated — there is no Load/Grid interaction while exporting.
 * - **Importing** (Load > PV): PV -> Load stays active (green) — PV's own
 *   contribution still reaches Load. PV -> Grid disappears (very light
 *   grey, no animation) — PV isn't exporting anything. The Load-Grid line
 *   becomes the active one: orange/red, particles animating Grid -> Load
 *   (right to left). This is the only place Grid and Load are ever
 *   connected.
 *
 * Every line is gated on the real magnitude it represents (`pvKw`/
 * `gridKw` > 0) — never shown active for a flow that isn't actually
 * happening, matching this codebase's "never fabricate" rule.
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

  // Coordinates share the same 0-100 x / 0-100 y space as the SVG viewBox
  // below, so the HTML icon nodes (positioned by percentage) and the SVG
  // lines/particles (positioned by these same numbers) always line up.
  const PV = { x: 50, y: 12 };
  // The horizontal branches run at exactly this y (NODE_Y), so each
  // branch terminates with zero additional vertical drop. The Load-Grid
  // line is a distinctly separate, lower line — never the same segment as
  // the branches above. The Load/Grid *icons* are rendered at
  // ICON_Y, the vertical midpoint between the two — centered between both
  // lines rather than attached to the upper branch (Dashboard visual
  // polish milestone).
  const NODE_Y = 55;
  const LOWER_LINE_Y = 72;
  const ICON_Y = (NODE_Y + LOWER_LINE_Y) / 2;
  const LOAD = { x: 22, y: NODE_Y };
  const GRID = { x: 78, y: NODE_Y };

  const INACTIVE_STROKE = "rgba(255,255,255,0.12)";
  const INACTIVE_DASH = "2 2";

  const pvActive = pvKw > 0;
  const exportingActive = !importing && gridKw > 0;
  const importingActive = importing && gridKw > 0;

  const trunkLeftPath = `M${PV.x - 1.4},${PV.y + 6} L${PV.x - 1.4},${NODE_Y}`;
  const trunkRightPath = `M${PV.x + 1.4},${PV.y + 6} L${PV.x + 1.4},${NODE_Y}`;
  const loadBranchPath = `M${PV.x - 1.4},${NODE_Y} L${LOAD.x},${NODE_Y}`;
  const gridBranchPath = `M${PV.x + 1.4},${NODE_Y} L${GRID.x},${NODE_Y}`;
  const lowerLinePath = `M${GRID.x},${LOWER_LINE_Y} L${LOAD.x},${LOWER_LINE_Y}`;

  const pvColor = pvActive ? "#34d399" : INACTIVE_STROKE;
  const gridBranchColor = exportingActive ? "#34d399" : INACTIVE_STROKE;
  const lowerLineColor = importingActive ? "#fb923c" : INACTIVE_STROKE;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="relative mx-auto aspect-square h-full w-auto max-h-[300px] max-w-full">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
          {/* PV -> Load: trunk (left rail) + left branch, always this color/state */}
          <path
            d={trunkLeftPath}
            stroke={pvColor}
            strokeWidth={pvActive ? 0.6 : 0.4}
            fill="none"
            strokeDasharray={pvActive ? undefined : INACTIVE_DASH}
          />
          <path
            d={loadBranchPath}
            stroke={pvColor}
            strokeWidth={pvActive ? 0.6 : 0.4}
            fill="none"
            strokeDasharray={pvActive ? undefined : INACTIVE_DASH}
          />

          {/* PV -> Grid: trunk (right rail) + right branch, one continuous path, active only while exporting */}
          <path
            d={trunkRightPath}
            stroke={gridBranchColor}
            strokeWidth={exportingActive ? 0.6 : 0.4}
            fill="none"
            strokeDasharray={exportingActive ? undefined : INACTIVE_DASH}
          />
          <path
            d={gridBranchPath}
            stroke={gridBranchColor}
            strokeWidth={exportingActive ? 0.6 : 0.4}
            fill="none"
            strokeDasharray={exportingActive ? undefined : INACTIVE_DASH}
          />

          {/* Load <-> Grid: a completely separate line, the only path ever used for Grid -> Load */}
          <path
            d={lowerLinePath}
            stroke={lowerLineColor}
            strokeWidth={importingActive ? 0.6 : 0.4}
            fill="none"
            strokeDasharray={importingActive ? undefined : INACTIVE_DASH}
          />

          {pvActive &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`trunk-load-${delay}`}
                r={0.9}
                fill="#6ee7b7"
                className="voltessa-flow-particle"
                style={{ offsetPath: `path('${trunkLeftPath} ${loadBranchPath.replace("M", "L")}')`, animationDelay: `${delay}s` }}
              />
            ))}

          {exportingActive &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`trunk-grid-${delay}`}
                r={0.9}
                fill="#6ee7b7"
                className="voltessa-flow-particle"
                style={{ offsetPath: `path('${trunkRightPath} ${gridBranchPath.replace("M", "L")}')`, animationDelay: `${delay}s` }}
              />
            ))}

          {importingActive &&
            [0, 0.7, 1.4].map((delay) => (
              <circle
                key={`grid-load-${delay}`}
                r={0.9}
                fill="#fdba74"
                className="voltessa-flow-particle"
                style={{ offsetPath: `path('${lowerLinePath}')`, animationDelay: `${delay}s` }}
              />
            ))}
        </svg>

        <FlowNode
          icon={<SolarPanelIcon className="h-7 w-7 text-emerald-300/90" />}
          label="PV"
          value={`${pvKw.toFixed(1)} kW`}
          valueFirst
          style={{ left: `${PV.x}%`, top: `${PV.y}%` }}
        />

        <FlowNode
          icon={<LoadBuildingIcon className="h-7 w-7 text-slate-300" />}
          label="Load"
          value={loadKw !== null ? `${loadKw.toFixed(1)} kW` : "Inconsistent"}
          style={{ left: `${LOAD.x}%`, top: `${ICON_Y}%` }}
        />

        <FlowNode
          icon={<TransmissionTowerIcon className="h-7 w-7 text-cyan-300/90" />}
          label="Grid"
          value={`${gridKw.toFixed(1)} kW`}
          style={{ left: `${GRID.x}%`, top: `${ICON_Y}%` }}
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

/**
 * Load/Grid: label above the icon, icon in the middle, value below (the
 * value is the most prominent text). PV: the same value/icon/label stack
 * reversed (`valueFirst`) — its power value is the most important number
 * in the diagram, so it renders above the icon instead of below.
 */
function FlowNode({
  icon,
  label,
  value,
  valueFirst,
  style,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  valueFirst?: boolean;
  style: CSSProperties;
}) {
  const valueText = <p className="text-sm font-semibold tabular-nums text-white">{value}</p>;
  const labelText = (
    <p className="text-[9px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
  );
  const iconCircle = (
    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#0f172a]/80">
      {icon}
    </div>
  );

  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
      style={style}
    >
      {valueFirst ? (
        <>
          {valueText}
          {iconCircle}
          {labelText}
        </>
      ) : (
        <>
          {labelText}
          {iconCircle}
          {valueText}
        </>
      )}
    </div>
  );
}
