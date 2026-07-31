import type { MetadataRoute } from "next";

import { buildLanguageAlternates } from "@/lib/i18n/seo";
import { routing } from "@/lib/i18n/routing";

const BASE_URL = "https://voltessa.ai";

/** Every publicly indexable, non-authenticated path — the platform app (dashboard, market, etc.) has no SEO value and isn't listed here. */
const PUBLIC_PATHS = ["", "/privacy", "/terms", "/cookie-policy", "/company"];

/**
 * One entry per (locale × public path), each carrying its own `alternates`
 * so search engines see the full `hreflang` set for every URL, not just the
 * page-level `<link>` tags. Adding a language later (Phase 2) only needs
 * `routing.ts`'s `LOCALES` array updated — this picks it up automatically.
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
