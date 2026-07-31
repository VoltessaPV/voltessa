import type { MetadataRoute } from "next";

import { buildLanguageAlternates } from "@/lib/i18n/seo";
import { routing } from "@/lib/i18n/routing";

const BASE_URL = "https://voltessa.ai";

/** Every publicly indexable, non-authenticated path — the platform app (dashboard, market, etc.) has no SEO value and isn't listed here. */
const PUBLIC_PATHS = ["", "/privacy", "/terms", "/cookie-policy", "/company"];

/**
 * One entry per (enabled locale × public path) — `routing.locales`, not
 * the full `LOCALES` archive, so a disabled locale (Bulgarian, pending QA -
 * see routing.ts's rollout-gate doc comment) is never advertised to search
 * engines while it's unreachable. Each entry carries its own `alternates`
 * so search engines see the full `hreflang` set for every URL, not just the
 * page-level `<link>` tags. Enabling a disabled language, or adding a new
 * one, only needs `routing.ts`'s `ENABLED_LOCALES` updated — this picks it
 * up automatically.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const path of PUBLIC_PATHS) {
    for (const locale of routing.locales) {
      entries.push({
        url: `${BASE_URL}/${locale}${path}`,
        priority: path === "" ? 1 : 0.5,
        alternates: {
          languages: buildLanguageAlternates(path),
        },
      });
    }
  }

  return entries;
}
