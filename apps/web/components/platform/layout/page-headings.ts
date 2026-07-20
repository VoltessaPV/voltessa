import { pageHeading as alerts } from "@/app/(platform)/alerts/heading";
import { pageHeading as automations } from "@/app/(platform)/automations/heading";
import { pageHeading as dashboard } from "@/app/(platform)/dashboard/heading";
import { pageHeading as market } from "@/app/(platform)/market/heading";
import { pageHeading as plants } from "@/app/(platform)/plants/heading";
import { pageHeading as plantDetails } from "@/app/(platform)/plants/[id]/heading";
import { pageHeading as plantEdit } from "@/app/(platform)/plants/[id]/edit/heading";
import { pageHeading as plantsNew } from "@/app/(platform)/plants/new/heading";
import { pageHeading as settings } from "@/app/(platform)/settings/heading";

export type PageHeadingContent = { eyebrow: string; title: string };

/**
 * Wiring only - the actual eyebrow/title copy for each page lives in that
 * page's own `heading.ts` (imported above), not here. This table just maps
 * a route to the object its own page already declared; it exists at all
 * only because a shared layout's header renders before the page it wraps,
 * so it can't receive that object as a prop the normal top-down way (see
 * PageHeading.tsx).
 */
const STATIC_ROUTES: Record<string, PageHeadingContent> = {
  "/dashboard": dashboard,
  "/market": market,
  "/automations": automations,
  "/alerts": alerts,
  "/settings": settings,
  "/plants": plants,
  "/plants/new": plantsNew,
};

export function resolvePageHeading(pathname: string): PageHeadingContent {
  const staticMatch = STATIC_ROUTES[pathname];
  if (staticMatch) {
    return staticMatch;
  }

  // /plants/[id] and /plants/[id]/edit - the only dynamic-segment routes
  // under (platform); everything else above is a static path.
  if (/^\/plants\/[^/]+\/edit$/.test(pathname)) {
    return plantEdit;
  }
  if (/^\/plants\/[^/]+$/.test(pathname)) {
    return plantDetails;
  }

  return { eyebrow: "", title: "" };
}
