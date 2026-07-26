import type { ReactNode } from "react";

type SettingsCardProps = {
  title: string;
  description?: string;
  /** Rendered next to the title (e.g. the "Connected with Google" badge) — same row, not a second header line. */
  headerAccessory?: ReactNode;
  children: ReactNode;
};

/**
 * The one card shell every Settings section renders through — same
 * `rounded-2xl border border-white/10 bg-white/[0.03]` + inset/drop shadow
 * every Market/Dashboard card already uses (see `MarketEventLog`,
 * `MarketInsights`), so the redesigned Settings page matches the rest of
 * the app's design language instead of inventing a second one.
 */
export function SettingsCard({
  title,
  description,
  headerAccessory,
  children,
}: SettingsCardProps) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_12px_28px_-16px_rgba(0,0,0,0.55)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          )}
        </div>

        {headerAccessory}
      </div>

      <div className="mt-4">{children}</div>
    </section>
  );
}
