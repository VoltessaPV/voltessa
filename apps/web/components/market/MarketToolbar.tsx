import { getTranslations } from "next-intl/server";

import { SUPPORTED_BIDDING_ZONES } from "@/lib/market-price/constants";

type MarketToolbarProps = {
  selectedDate: string;
  prevDateParam: string;
  nextDateParam: string;
  isToday: boolean;
  /** Route this toolbar navigates within — defaults to `/market`. Dashboard passes `/dashboard` to reuse this exact component (Dashboard visual polish milestone) rather than a second copy. */
  basePath?: string;
};

export async function MarketToolbar({
  selectedDate,
  prevDateParam,
  nextDateParam,
  isToday,
  basePath = "/market",
}: MarketToolbarProps) {
  const [t, tInfo] = await Promise.all([
    getTranslations("market.toolbar"),
    getTranslations("market.info"),
  ]);

  /**
   * Only "today" is wired to real data this milestone. The others are
   * rendered disabled rather than omitted so activating one later is
   * flipping `enabled: true` and giving it a real `getMarketPageData`
   * range, not redesigning this toolbar.
   */
  const timeRangeOptions = [
    { key: "today", label: t("todayRange"), enabled: true },
    { key: "week", label: t("weekRange"), enabled: false },
    { key: "month", label: t("monthRange"), enabled: false },
    { key: "year", label: t("yearRange"), enabled: false },
  ] as const;

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

        <a
          href={`${basePath}?date=${prevDateParam}`}
          aria-label={t("previousDay")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition hover:border-white/20 hover:text-white"
        >
          ‹
        </a>

        <form action={basePath} method="get" className="flex items-center gap-1.5">
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
          href={`${basePath}?date=${nextDateParam}`}
          aria-label={t("nextDay")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition hover:border-white/20 hover:text-white"
        >
          ›
        </a>

        <a
          href={basePath}
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
          {timeRangeOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={!option.enabled}
              title={option.enabled ? undefined : t("comingSoon")}
              className={
                option.enabled
                  ? "rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white"
                  : "cursor-not-allowed rounded-md px-2.5 py-1 text-xs font-medium text-slate-600"
              }
            >
              {option.label}
              {!option.enabled && (
                <span className="ml-1 text-[9px] uppercase tracking-wide text-slate-700">
                  {t("soonBadge")}
                </span>
              )}
            </button>
          ))}
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
