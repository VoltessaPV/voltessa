import type { MarketInsight } from "@/app/(platform)/market/market-data";

type MarketInsightsProps = {
  insights: MarketInsight[];
};

const TONE_DOT_CLASS: Record<MarketInsight["tone"], string> = {
  positive: "bg-emerald-400",
  warning: "bg-amber-400",
  neutral: "bg-slate-500",
};

export function MarketInsights({ insights }: MarketInsightsProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        Market Insights
      </p>

      <ul className="mt-4 space-y-3">
        {insights.map((insight, index) => (
          <li key={index} className="flex items-start gap-2.5">
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT_CLASS[insight.tone]}`}
            />
            <span className="text-sm leading-snug text-slate-300">
              {insight.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
