import { pageHeading as adminDashboard } from "@/app/(platform)/admin/heading";
import { pageHeading as adminAssignments } from "@/app/(platform)/admin/assignments/heading";
import { pageHeading as adminAuditLog } from "@/app/(platform)/admin/audit-log/heading";
import { pageHeading as adminPlantOwners } from "@/app/(platform)/admin/plant-owners/heading";
import { pageHeading as adminPlantOwnerDetails } from "@/app/(platform)/admin/plant-owners/[id]/heading";
import { pageHeading as adminTraders } from "@/app/(platform)/admin/traders/heading";
import { pageHeading as adminTraderDetails } from "@/app/(platform)/admin/traders/[id]/heading";
import { pageHeading as adminUsers } from "@/app/(platform)/admin/users/heading";
import { pageHeading as adminUserDetails } from "@/app/(platform)/admin/users/[id]/heading";
import { pageHeading as adminDeletedUsers } from "@/app/(platform)/admin/users/deleted/heading";
import { pageHeading as alerts } from "@/app/(platform)/alerts/heading";
import { pageHeading as automations } from "@/app/(platform)/automations/heading";
import { pageHeading as bess } from "@/app/(platform)/bess/heading";
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
  "/bess": bess,
  "/automations": automations,
  "/alerts": alerts,
  "/settings": settings,
  "/plants": plants,
  "/plants/new": plantsNew,
  "/admin": adminDashboard,
  "/admin/users": adminUsers,
  "/admin/users/deleted": adminDeletedUsers,
  "/admin/plant-owners": adminPlantOwners,
  "/admin/traders": adminTraders,
  "/admin/assignments": adminAssignments,
  "/admin/audit-log": adminAuditLog,
};

export function resolvePageHeading(pathname: string): PageHeadingContent {
  const staticMatch = STATIC_ROUTES[pathname];
  if (staticMatch) {
    return staticMatch;
  }

  // /plants/[id] and /plants/[id]/edit - the only dynamic-segment routes
  // under (platform) until the Platform Administration milestone added
  // its own three (/admin/users/[id], /admin/plant-owners/[id],
  // /admin/traders/[id]) - everything else above is a static path.
  if (/^\/plants\/[^/]+\/edit$/.test(pathname)) {
    return plantEdit;
  }
  if (/^\/plants\/[^/]+$/.test(pathname)) {
    return plantDetails;
  }
  if (/^\/admin\/users\/[^/]+$/.test(pathname)) {
    return adminUserDetails;
  }
  if (/^\/admin\/plant-owners\/[^/]+$/.test(pathname)) {
    return adminPlantOwnerDetails;
  }
  if (/^\/admin\/traders\/[^/]+$/.test(pathname)) {
    return adminTraderDetails;
  }

  return { eyebrow: "", title: "" };
}
