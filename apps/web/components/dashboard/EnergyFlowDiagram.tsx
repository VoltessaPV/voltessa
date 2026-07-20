import type { CSSProperties, ReactNode } from "react";

import type { EnergyFlowState } from "@/app/(platform)/dashboard/dashboard-data";
import { LoadBuildingIcon, SolarPanelIcon, TransmissionTowerIcon } from "@/components/dashboard/energy-icons";

type EnergyFlowDiagramProps = {
  flow: EnergyFlowState;
  /** Historical days never have a live Huawei reading — see this component's "unavailable" branch for the friendlier wording that distinguishes the two cases (Dashboard UI final polish milestone). */
  isToday: boolean;
};

/**
 * Huawei-style PV / Load / Grid diagram. Same domain input as every prior
 * iteration (`lib/telemetry/energy-flow.ts`'s `deriveEnergyFlow`,
 * unchanged) — this component only decides how to color/animate lines,
 * never a new calculation. Topology is unchanged from the previous pass
 * (three genuinely independent lines, never a `PV -> Load -> Grid` chain):
 *
 * - A double vertical line drops from PV straight down to a single split
 *   point, which then turns exactly once — one branch running left to
 *   Load, one running right to Grid. No further vertical drops after the
 *   split; each branch ends directly at its node.
 * - A completely separate horizontal line connects Load and Grid, drawn
 *   below the PV branches — this is the ONLY line ever used for
 *   Grid -> Load.
 *
 * Load/Grid's rendered node horizontally shares its branch's own x
 * (`LOAD.x`/`GRID.x` drive both the line and the `FlowNode` position —
 * never two separate x values). Vertically, the icon is deliberately
 * centered exactly midway between the two horizontal lines that define
 * it (`ICON_Y`, the literal midpoint of `NODE_Y`/`LOWER_LINE_Y`) rather
 * than sitting on either line — distance(branch -> icon) always equals
 * distance(icon -> lower line). The lines themselves never move to match
 * the icon; only the icon centers between them.
 *
 * - **Exporting** (PV > Load): PV -> Load and PV -> Grid are the two
 *   active, green, particled flows. The Load-Grid line stays a static,
 *   very light grey, dashed, never animated.
 * - **Importing** (Load > PV): PV -> Load stays active (green); PV -> Grid
 *   disappears (very light grey, no animation); the Load-Grid line
 *   becomes the active one: orange, particles animating Grid -> Load.
 *
 * Every line is gated on the real magnitude it represents (`pvKw`/
 * `gridKw` > 0) — never shown active for a flow that isn't happening.
 */
export function EnergyFlowDiagram({ flow, isToday }: EnergyFlowDiagramProps) {
  if (!flow.available) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-slate-500">
        {isToday ? "Live meter data unavailable" : "No historical live meter data available"}
      </div>
    );
  }

  const { pvKw, consumption, direction, gridKw } = flow;
  const importing = direction === "importing";
  const loadKw = consumption.consistent ? consumption.kw : null;

  // Coordinates share the same 0-100 x / 0-VIEWBOX_HEIGHT y space as the
  // SVG viewBox below, so the HTML icon nodes (positioned by percentage)
  // and the SVG lines/particles (positioned by these same numbers) always
  // line up. A tighter viewBox height than a plain square (rather than
  // 0-100) removes the dead space below the lower line that made the
  // previous pass feel sparse.
  const VIEWBOX_HEIGHT = 80;
  const PV = { x: 50, y: 10 };
  // The horizontal branches run at exactly this y (NODE_Y) and the
  // Load-Grid line at LOWER_LINE_Y — both fixed, unchanged line geometry.
  // `LOAD`/`GRID` (x, and NODE_Y for the branch endpoint) still drive the
  // SVG paths directly, so the lines themselves never move. The rendered
  // icon's vertical center is a separate value, `ICON_Y`: the exact
  // midpoint between the two lines, so distance(branch -> icon) always
  // equals distance(icon -> lower line) for both Load and Grid — the
  // lines are never pulled to match the icon, only the icon centers
  // between them.
  const NODE_Y = 50;
  const LOWER_LINE_Y = NODE_Y + 3;
  const ICON_Y = (NODE_Y + LOWER_LINE_Y) / 2;
  const LOAD = { x: 28, y: NODE_Y };
  const GRID = { x: 72, y: NODE_Y };

  const INACTIVE_STROKE = "rgba(255,255,255,0.12)";
  const INACTIVE_DASH = "2 2";
  // ~45% slower than the shared `voltessa-flow-particle` keyframe's own
  // default 2.2s (globals.css) — overridden per-particle here rather than
  // changing that shared class, since this component is its only
  // consumer today but the class itself shouldn't assume that forever.
  const PARTICLE_DURATION = "3.2s";
  const PARTICLE_DELAYS = [0, 1, 2];

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

  const toTopPercent = (y: number) => `${(y / VIEWBOX_HEIGHT) * 100}%`;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="relative mx-auto w-full max-w-full" style={{ aspectRatio: `100 / ${VIEWBOX_HEIGHT}`, height: "100%", maxHeight: 340 }}>
        <svg
          viewBox={`0 0 100 ${VIEWBOX_HEIGHT}`}
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
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
            PARTICLE_DELAYS.map((delay) => (
              <circle
                key={`trunk-load-${delay}`}
                r={0.9}
                fill="#6ee7b7"
                className="voltessa-flow-particle"
                style={{
                  offsetPath: `path('${trunkLeftPath} ${loadBranchPath.replace("M", "L")}')`,
                  animationDelay: `${delay}s`,
                  animationDuration: PARTICLE_DURATION,
                }}
              />
            ))}

          {exportingActive &&
            PARTICLE_DELAYS.map((delay) => (
              <circle
                key={`trunk-grid-${delay}`}
                r={0.9}
                fill="#6ee7b7"
                className="voltessa-flow-particle"
                style={{
                  offsetPath: `path('${trunkRightPath} ${gridBranchPath.replace("M", "L")}')`,
                  animationDelay: `${delay}s`,
                  animationDuration: PARTICLE_DURATION,
                }}
              />
            ))}

          {importingActive &&
            PARTICLE_DELAYS.map((delay) => (
              <circle
                key={`grid-load-${delay}`}
                r={0.9}
                fill="#fdba74"
                className="voltessa-flow-particle"
                style={{
                  offsetPath: `path('${lowerLinePath}')`,
                  animationDelay: `${delay}s`,
                  animationDuration: PARTICLE_DURATION,
                }}
              />
            ))}
        </svg>

        <FlowNode
          icon={<SolarPanelIcon className="h-[31px] w-[31px] text-emerald-300/90" />}
          label="PV"
          value={`${pvKw.toFixed(1)} kW`}
          layout="labelValueIcon"
          style={{ left: `${PV.x}%`, top: toTopPercent(PV.y) }}
        />

        <FlowNode
          icon={<LoadBuildingIcon className="h-[31px] w-[31px] text-slate-300" />}
          label="Load"
          value={loadKw !== null ? `${loadKw.toFixed(1)} kW` : "Inconsistent"}
          style={{ left: `${LOAD.x}%`, top: toTopPercent(ICON_Y) }}
        />

        <FlowNode
          icon={<TransmissionTowerIcon className="h-[31px] w-[31px] text-cyan-300/90" />}
          label="Grid"
          value={`${gridKw.toFixed(1)} kW`}
          style={{ left: `${GRID.x}%`, top: toTopPercent(ICON_Y) }}
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
 * Load/Grid (default, `layout="iconLabelValue"`): icon, then label, then
 * value — the value is the most prominent text, unchanged. PV
 * (`layout="labelValueIcon"`): label, then value, then icon — its power
 * value is the most important number in the diagram, so it renders above
 * the icon instead of below. Labels are bold and bright white (not muted
 * slate) for readability; power values stay bold.
 */
function FlowNode({
  icon,
  label,
  value,
  layout = "iconLabelValue",
  style,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  layout?: "iconLabelValue" | "labelValueIcon";
  style: CSSProperties;
}) {
  const valueText = <p className="text-sm font-bold tabular-nums text-white">{value}</p>;
  const labelText = <p className="text-[10px] font-bold uppercase tracking-wider text-white">{label}</p>;
  const iconCircle = (
    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#0f172a]/80">
      {icon}
    </div>
  );

  // `-translate-y-1/2` centers the whole icon+label+value block on `style`'s
  // anchor point — correct for PV (labelValueIcon), whose anchor isn't
  // required to sit at the icon's own center. For Load/Grid
  // (iconLabelValue), the anchor must be the ICON's center specifically
  // (exactly midway between the two horizontal lines): since the icon (a
  // fixed h-10 = 40px) is the first element with label/value stacked below
  // it, centering the *whole block* instead pulls the anchor down past the
  // icon's own center, landing near its bottom edge. Translating by a fixed
  // -20px (half the icon's own height) instead of -50% of the whole block
  // puts the icon's true center exactly on the anchor point.
  const verticalTranslateClass = layout === "labelValueIcon" ? "-translate-y-1/2" : "-translate-y-5";

  return (
    <div
      className={`absolute flex -translate-x-1/2 ${verticalTranslateClass} flex-col items-center gap-0.5`}
      style={style}
    >
      {layout === "labelValueIcon" ? (
        <>
          {labelText}
          {valueText}
          {iconCircle}
        </>
      ) : (
        <>
          {iconCircle}
          {labelText}
          {valueText}
        </>
      )}
    </div>
  );
}
