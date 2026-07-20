/**
 * No production-forecasting model exists anywhere in this codebase
 * (confirmed by search, not assumed). Rather than list four metrics that
 * are each individually unavailable (the previous design), a compact
 * roadmap placeholder is more honest — and avoids repeating "current
 * production", which the System Overview's PV node already shows (no
 * duplicated KPIs, per this milestone's explicit rule). Building a real
 * forecast model is explicit future work.
 */
export function GlidepathCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Glidepath</p>
      <p className="mt-3 text-sm text-slate-500">Production forecasting is on the roadmap.</p>
    </div>
  );
}
