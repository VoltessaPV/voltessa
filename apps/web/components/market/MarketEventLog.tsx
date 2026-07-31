"use client";

import { History } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  BULGARIA_TIMEZONE,
  type MarketEventLogEntry,
} from "@/app/[locale]/(platform)/market/market-data";

type MarketEventLogProps = {
  entries: MarketEventLogEntry[];
};

const EVENT_DOT_CLASS: Record<MarketEventLogEntry["type"], string> = {
  mode_changed: "bg-emerald-400",
  automation_service_failed: "bg-red-400",
  reconciliation_mismatch: "bg-amber-400",
  reconciliation_synced: "bg-emerald-400",
  reconciliation_failed: "bg-red-400",
  reconciliation_restored: "bg-emerald-400",
};

/**
 * DD/MM/YYYY HH:mm, no seconds — always in `BULGARIA_TIMEZONE`, the same
 * timezone `market-data.ts`/`production-data.ts` use for every other
 * timestamp on the Market page, never the server's own timezone (UTC on
 * Vercel) or the viewer's browser timezone.
 */
function marketTimestampLabel(date: Date): string {
  const datePart = date.toLocaleDateString("en-GB", {
    timeZone: BULGARIA_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString("en-GB", {
    timeZone: BULGARIA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${datePart} ${timePart}`;
}

/**
 * A real, user-facing event log — the automation engine's own
 * `AutomationEvent` records, already filtered server-side to automation
 * *behavior* (mode switches, failed automation commands), never internal
 * sync/reconciliation bookkeeping (see `getRecentAutomationEvents`'s doc
 * comment). Newest first, up to 10.
 *
 * Fixed height (~ Market Insights / Dashboard Inverters) with its own
 * internal scrollbar, so a full list of 10 events never grows this card
 * taller than its row siblings - only the list scrolls, the header stays
 * pinned.
 */
export function MarketEventLog({ entries }: MarketEventLogProps) {
  const t = useTranslations("market.eventLog");

  return (
    <div className="flex h-[280px] flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <p className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
        <History className="h-3.5 w-3.5" />
        {t("title")}
      </p>

      {entries.length === 0 ? (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center py-6 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-slate-600">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              className="h-4 w-4"
              aria-hidden
            >
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10 6.5V10l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
          <p className="mt-3 text-sm text-slate-400">{t("emptyTitle")}</p>
          <p className="mt-1 max-w-[220px] text-xs text-slate-600">{t("emptyDescription")}</p>
        </div>
      ) : (
        <ol className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
          {entries.map((entry, index) => (
            <li key={`${entry.timestamp.toISOString()}-${index}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${EVENT_DOT_CLASS[entry.type]}`}
                />
                {index < entries.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-white/10" />
                )}
              </div>

              <div className="pb-1">
                <p className="text-sm font-medium text-white">
                  {marketTimestampLabel(entry.timestamp)}  {entry.label}
                </p>
                {entry.detail && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    {entry.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
