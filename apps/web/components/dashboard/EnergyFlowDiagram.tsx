import type { EnergyFlowState } from "@/app/(platform)/dashboard/dashboard-data";

type EnergyFlowDiagramProps = {
  flow: EnergyFlowState;
};

/**
 * Real-time PV -> Home -> Grid energy flow (Design-System Consistency
 * milestone). Exactly three nodes, always — never a second Grid or a
 * second Home. Exactly two possible states, never a third "idle" one:
 *
 * - Case A (`exporting`): PV >= Consumption. `PV -> Home -> Grid`, Grid
 *   shows exported power.
 * - Case B (`importing`): Consumption > PV. `PV -> Home <- Grid`, Grid
 *   shows imported power.
 *
 * Direction and every value are read directly from `flow`
 * (`lib/telemetry/energy-flow.ts`'s `deriveEnergyFlow`, the one documented
 * domain calculation) — this component never modifies, clamps, or floors
 * anything itself. PV/Grid are always the real measured readings; Home
 * shows "Inconsistent" instead of a number on the rare occasion the two
 * independently-read devices momentarily disagree (`consumption.consistent
 * === false`) — never a fabricated or clamped value. Pure CSS motion-path
 * animation (see `app/globals.css`'s `voltessa-flow-particle` keyframes,
 * the same subtle animation style used elsewhere) — no client JS needed
 * for particles moving along a fixed path at a constant rate, so this
 * stays a plain server component.
 */
export function EnergyFlowDiagram({ flow }: EnergyFlowDiagramProps) {
  if (!flow.available) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">
        Live meter data unavailable
      </div>
    );
  }

  const { pvKw, consumption, direction, gridKw } = flow;
  const importing = direction === "importing";

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 640 200" className="h-[200px] w-full max-w-[640px]" aria-hidden>
        <defs>
          <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#475569" />
          </marker>
        </defs>

        {/* PV -> Home path, always present and always this direction */}
        <line x1={150} y1={100} x2={270} y2={100} stroke="rgba(255,255,255,0.12)" strokeWidth={2} />
        <line
          x1={150}
          y1={100}
          x2={262}
          y2={100}
          stroke="#34d399"
          strokeWidth={2}
          markerEnd="url(#flow-arrow)"
        />

        {/* Home <-> Grid path — exactly one direction active, never both */}
        <line x1={370} y1={100} x2={490} y2={100} stroke="rgba(255,255,255,0.12)" strokeWidth={2} />
        {importing ? (
          <line
            x1={490}
            y1={100}
            x2={378}
            y2={100}
            stroke="#22d3ee"
            strokeWidth={2}
            markerEnd="url(#flow-arrow)"
          />
        ) : (
          <line
            x1={370}
            y1={100}
            x2={482}
            y2={100}
            stroke="#22d3ee"
            strokeWidth={2}
            markerEnd="url(#flow-arrow)"
          />
        )}

        {/* Animated particles, PV -> Home, whenever PV is producing */}
        {pvKw > 0 &&
          [0, 0.7, 1.4].map((delay) => (
            <circle
              key={`pv-${delay}`}
              r={3.5}
              fill="#6ee7b7"
              className="voltessa-flow-particle"
              style={{ offsetPath: "path('M150,100 L266,100')", animationDelay: `${delay}s` }}
            />
          ))}

        {/* Animated particles, Home <-> Grid — direction-aware, one path only */}
        {[0, 0.7, 1.4].map((delay) => (
          <circle
            key={`grid-${delay}`}
            r={3.5}
            fill="#67e8f9"
            className="voltessa-flow-particle"
            style={{
              offsetPath: importing ? "path('M490,100 L374,100')" : "path('M370,100 L486,100')",
              animationDelay: `${delay}s`,
            }}
          />
        ))}

        {/* PV node */}
        <circle cx={90} cy={100} r={44} fill="#0f172a" stroke="rgba(52,211,153,0.4)" strokeWidth={1.5} />
        <text x={90} y={92} textAnchor="middle" fontSize={11} fontWeight={600} fill="#e2e8f0">
          PV
        </text>
        <text x={90} y={110} textAnchor="middle" fontSize={13} fontWeight={700} fill="#6ee7b7">
          {pvKw.toFixed(1)}
        </text>
        <text x={90} y={124} textAnchor="middle" fontSize={9} fill="#64748b">
          kW
        </text>

        {/* Home node */}
        <circle
          cx={320}
          cy={100}
          r={44}
          fill="#0f172a"
          stroke={consumption.consistent ? "rgba(255,255,255,0.15)" : "rgba(251,191,36,0.4)"}
          strokeWidth={1.5}
        />
        <text x={320} y={92} textAnchor="middle" fontSize={11} fontWeight={600} fill="#e2e8f0">
          Home
        </text>
        {consumption.consistent ? (
          <>
            <text x={320} y={110} textAnchor="middle" fontSize={13} fontWeight={700} fill="#f8fafc">
              {consumption.kw.toFixed(1)}
            </text>
            <text x={320} y={124} textAnchor="middle" fontSize={9} fill="#64748b">
              kW
            </text>
          </>
        ) : (
          <text x={320} y={112} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fbbf24">
            Inconsistent
          </text>
        )}

        {/* Grid node */}
        <circle cx={550} cy={100} r={44} fill="#0f172a" stroke="rgba(34,211,238,0.4)" strokeWidth={1.5} />
        <text x={550} y={92} textAnchor="middle" fontSize={11} fontWeight={600} fill="#e2e8f0">
          Grid
        </text>
        <text x={550} y={110} textAnchor="middle" fontSize={13} fontWeight={700} fill="#67e8f9">
          {gridKw.toFixed(1)}
        </text>
        <text x={550} y={124} textAnchor="middle" fontSize={9} fill="#64748b">
          kW
        </text>
      </svg>

      <div className="flex items-center gap-2 text-sm">
        <span className={`h-1.5 w-1.5 rounded-full ${importing ? "bg-cyan-400" : "bg-emerald-400"}`} />
        <span className="font-medium text-white">{importing ? "Importing" : "Exporting"}</span>
        <span className="tabular-nums text-slate-400">{gridKw.toFixed(1)} kW</span>
      </div>

      {!consumption.consistent && (
        <p className="max-w-md text-center text-xs text-amber-400/80">
          PV and grid readings are momentarily inconsistent — consumption can&apos;t be derived
          right now. PV and Grid above are the real measured values, unmodified.
        </p>
      )}
    </div>
  );
}
