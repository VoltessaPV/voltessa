import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

/**
 * The "nothing to show yet" card, shared across platform pages. Dashboard
 * and Market each already had their own copy of this exact markup for
 * their own pre-existing empty states (no plant, no ENTSO-E price data for
 * the selected day) - Automations and BESS now reuse it too instead of a
 * third/fourth copy, and Dashboard/Market's own inline JSX was replaced by
 * this component rather than left duplicated.
 */
export function EmptyState({ title, description, children }: EmptyStateProps) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{description}</p>
      {children && <div className="mt-5 flex justify-center">{children}</div>}
    </section>
  );
}
