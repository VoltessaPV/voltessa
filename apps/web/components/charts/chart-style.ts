/**
 * Shared visual identity for every `recharts`-based chart in the app
 * (Design-System Consistency milestone) — extracted from `MarketPriceChart`,
 * the reference implementation, so the Dashboard's power chart (and any
 * future chart) shares the exact same grid/axis/tooltip chrome instead of
 * a second, independently-styled implementation. Only the plotted series
 * differ between charts; this file is what makes that true architecturally,
 * not just by visual coincidence.
 */

export function formatSofiaTime(time: number): string {
  return new Date(time).toLocaleTimeString("en-GB", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const CHART_GRID_STROKE = "rgba(255,255,255,0.05)";

export const CHART_AXIS_TICK = { fill: "#64748b", fontSize: 11 } as const;

export const CHART_AXIS_LINE = { stroke: "rgba(255,255,255,0.1)" } as const;

export const CHART_TOOLTIP_CLASSNAME =
  "rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-xs shadow-[0_12px_28px_-16px_rgba(0,0,0,0.7)]";

export const CHART_MARGIN = { top: 30, right: 12, bottom: 0, left: 0 } as const;
export const CHART_MARGIN_WITH_ANNOTATION = { top: 46, right: 12, bottom: 0, left: 0 } as const;

/**
 * Fixed tick marks at every odd hour (01:00, 03:00, ..., 23:00) for a full
 * Europe/Sofia calendar-day chart (Dashboard visual polish milestone) —
 * used instead of recharts' automatic tick placement, which doesn't land on
 * round hours for a `[dayStart, dayEnd)` domain. Both Market's price chart
 * and Dashboard's Live Energy chart pass their own `dayStart` (in ms) here
 * so the two charts always show identical X-axis labels.
 */
export function computeFixedHourlyTicks(dayStartMs: number): number[] {
  const ticks: number[] = [];

  for (let hour = 1; hour <= 23; hour += 2) {
    ticks.push(dayStartMs + hour * 60 * 60 * 1000);
  }

  return ticks;
}
