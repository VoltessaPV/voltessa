import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Locale-aware drop-in replacements for `next/link`'s `Link` and
 * `next/navigation`'s `redirect`/`usePathname`/`useRouter` — every
 * customer-facing file under `app/[locale]/**` uses these instead of the
 * plain Next.js versions, so navigation stays within the current locale
 * (no re-detection round-trip on every click) and route slugs stay
 * identical across locales per `routing.ts`. `/admin` and `/dev` (outside
 * `[locale]` entirely) keep using plain `next/link`/`next/navigation` —
 * they were never part of this routing to begin with.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
