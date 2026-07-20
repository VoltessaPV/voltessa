/**
 * No weather data provider is wired up anywhere in this codebase (no API
 * integration, no credential, no model) — confirmed by search, not
 * assumed. Rather than show a row of "Not connected" fields (the previous
 * design), a compact placeholder is more honest about the actual state:
 * there is nothing to show yet, not five things that are each
 * individually unavailable. Wiring a real provider is explicit future
 * work, not attempted here (Design-System Consistency milestone is UI-
 * only, no backend changes).
 */
export function WeatherCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Weather</p>
      <p className="mt-3 text-sm text-slate-500">Weather integration coming soon.</p>
    </div>
  );
}
