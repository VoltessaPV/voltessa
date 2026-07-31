"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/lib/i18n/navigation";

import { resolveAdminPageHeading, resolveCustomerPageHeadingKey } from "./page-headings";

/** Route keys whose title is exactly a canonical `terminology.*` term - interpolated from there instead of re-authoring the same word in `navigation.pageHeadings` (`i18n:check-terminology` flags exactly that duplication). */
const TITLE_IS_TERMINOLOGY: Record<string, string> = {
  dashboard: "dashboard",
  market: "market",
  settings: "settings",
};

/**
 * The only place the fixed header's eyebrow/title actually render - reads
 * the current route via `usePathname` (a client component is the only way
 * a shared layout's header, which renders before the page it wraps, can
 * know which page it's on). Admin routes resolve to their own static,
 * English-only content (`resolveAdminPageHeading`, unchanged); every
 * customer route resolves to a `navigation.pageHeadings` translation key
 * (`resolveCustomerPageHeadingKey`) - see page-headings.ts.
 */
export function PageHeading() {
  const pathname = usePathname();
  const t = useTranslations("navigation.pageHeadings");
  const tTerm = useTranslations("terminology");

  const adminHeading = resolveAdminPageHeading(pathname);
  const customerKey = adminHeading ? null : resolveCustomerPageHeadingKey(pathname);
  const terminologyKey = customerKey ? TITLE_IS_TERMINOLOGY[customerKey] : undefined;

  const eyebrow = adminHeading?.eyebrow ?? (customerKey ? t(`${customerKey}.eyebrow` as never) : "");
  const title =
    adminHeading?.title ??
    (terminologyKey
      ? tTerm(terminologyKey as never)
      : customerKey
        ? t(`${customerKey}.title` as never)
        : "");

  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-medium text-cyan-400">{eyebrow}</p>
      <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight text-white">
        {title}
      </h1>
    </div>
  );
}
