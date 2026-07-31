import { getTranslations } from "next-intl/server";

import { SUPPORTED_BIDDING_ZONES } from "@/lib/market-price/constants";
import type { CalendarPeriod } from "@/lib/market-price/timezone";

type MarketToolbarProps = {
  period: CalendarPeriod;
  selectedDate: string;
  prevDateParam: string;
  nextDateParam: string;
  isToday: boolean;
  periodRangeLabel: string;
  /** Route this toolbar navigates within — defaults to `/market`. Dashboard passes `/dashboard` to reuse this exact component (Dashboard visual polish milestone) rather than a second copy. */
  basePath?: string;
};

export async function MarketToolbar({
  period,
  selectedDate,
  prevDateParam,
  nextDateParam,
  isToday,
  periodRangeLabel,
  basePath = "/market",
}: MarketToolbarProps) {
  const [t, tInfo] = await Promise.all([
    getTranslations("market.toolbar"),
    getTranslations("market.info"),
  ]);

  /**
   * Dashboard & Market Analytics milestone: all four periods are real now —
   * `?period=<key>&date=<selectedDate>` keeps whichever day/period-anchor
   * date is currently selected when switching periods, so switching from
   * "Today" to "Week" shows the week containing that same date.
   */
  const timeRangeOptions = [
    { key: "today" as const, label: t("todayRange") },
    { key: "week" as const, label: t("weekRange") },
    { key: "month" as const, label: t("monthRange") },
    { key: "year" as const, label: t("yearRange") },
  ];

  const resolutionOptions = [{ value: "15", label: t("resolution15min") }] as const;

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-2 h-8">
          <span
            className={`h-1.5 w-1.5 rounded-full ${isToday ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`}
          />
          <span
            className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? "text-emerald-400" : "text-slate-600"}`}
          >
            {isToday ? t("live") : t("historical")}
          </span>
        </div>

        <span className="text-xs text-slate-400">{periodRangeLabel}</span>

        <a
          href={`${basePath}?period=${period}&date=${prevDateParam}`}
          aria-label={t("previousDay")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition hover:border-white/20 hover:text-white"
        >
          ‹
        </a>

        <form action={basePath} method="get" className="flex items-center gap-1.5">
          <input type="hidden" name="period" value={period} />
          <input
            type="date"
            name="date"
            defaultValue={selectedDate}
            className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white [color-scheme:dark]"
          />
          <button
            type="submit"
            className="h-8 rounded-lg border border-white/10 px-2.5 text-xs font-medium text-slate-300 transition hover:border-white/20 hover:text-white"
          >
            {t("goButton")}
          </button>
        </form>

        <a
          href={`${basePath}?period=${period}&date=${nextDateParam}`}
          aria-label={t("nextDay")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition hover:border-white/20 hover:text-white"
        >
          ›
        </a>

        <a
          href={`${basePath}?period=today`}
          aria-disabled={isToday}
          className={
            isToday
              ? "h-8 cursor-default rounded-lg border border-white/5 px-2.5 text-xs font-medium leading-8 text-slate-600"
              : "h-8 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 text-xs font-medium leading-8 text-cyan-300 transition hover:bg-cyan-500/15"
          }
        >
          {t("todayButton")}
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-0.5">
          {timeRangeOptions.map((option) => {
            const isActive = option.key === period;

            return (
              <a
                key={option.key}
                href={`${basePath}?period=${option.key}&date=${selectedDate}`}
                aria-current={isActive ? "true" : undefined}
                className={
                  isActive
                    ? "rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white"
                    : "rounded-md px-2.5 py-1 text-xs font-medium text-slate-400 transition hover:text-white"
                }
              >
                {option.label}
              </a>
            );
          })}
        </div>

        <select
          disabled
          defaultValue={SUPPORTED_BIDDING_ZONES[0]?.code}
          aria-label={t("countryLabel")}
          className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {SUPPORTED_BIDDING_ZONES.map((zone) => (
            <option key={zone.code} value={zone.code}>
              {zone.label === "Bulgaria" ? tInfo("countryName") : zone.label}
            </option>
          ))}
        </select>

        <select
          disabled
          defaultValue={resolutionOptions[0].value}
          aria-label={t("resolutionLabel")}
          className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {resolutionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
