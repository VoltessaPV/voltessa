import { pageHeading as adminDashboard } from "@/app/admin/heading";
import { pageHeading as adminAssignments } from "@/app/admin/assignments/heading";
import { pageHeading as adminAuditLog } from "@/app/admin/audit-log/heading";
import { pageHeading as adminOperations } from "@/app/admin/operations/heading";
import { pageHeading as adminHistoricalImports } from "@/app/admin/historical-imports/heading";
import { pageHeading as adminPlantOwners } from "@/app/admin/plant-owners/heading";
import { pageHeading as adminPlantOwnerDetails } from "@/app/admin/plant-owners/[id]/heading";
import { pageHeading as adminTraders } from "@/app/admin/traders/heading";
import { pageHeading as adminTraderDetails } from "@/app/admin/traders/[id]/heading";
import { pageHeading as adminUsers } from "@/app/admin/users/heading";
import { pageHeading as adminUserDetails } from "@/app/admin/users/[id]/heading";
import { pageHeading as adminDeletedUsers } from "@/app/admin/users/deleted/heading";

export type PageHeadingContent = { eyebrow: string; title: string };

/**
 * Platform Admin stays English-only (Full Internationalization milestone) —
 * its eyebrow/title copy is still wired the original way, one static object
 * per route imported from that page's own `heading.ts`. Every non-admin
 * route's copy instead lives in `messages/<locale>/navigation.json`'s
 * `pageHeadings` namespace and is translated in `PageHeading.tsx` via
 * `resolveCustomerPageHeadingKey` below, since a shared layout's header
 * (which renders before the page it wraps) can't receive translated text as
 * a normal top-down prop from the page itself.
 */
const ADMIN_STATIC_ROUTES: Record<string, PageHeadingContent> = {
  "/admin": adminDashboard,
  "/admin/users": adminUsers,
  "/admin/users/deleted": adminDeletedUsers,
  "/admin/plant-owners": adminPlantOwners,
  "/admin/traders": adminTraders,
  "/admin/assignments": adminAssignments,
  "/admin/audit-log": adminAuditLog,
  "/admin/operations": adminOperations,
  "/admin/historical-imports": adminHistoricalImports,
};

export function resolveAdminPageHeading(pathname: string): PageHeadingContent | null {
  const staticMatch = ADMIN_STATIC_ROUTES[pathname];
  if (staticMatch) {
    return staticMatch;
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

  return null;
}

const CUSTOMER_ROUTE_KEYS: Record<string, string> = {
  "/dashboard": "dashboard",
  "/clients": "clients",
  "/market": "market",
  "/bess": "bess",
  "/automations": "automations",
  "/alerts": "alerts",
  "/settings": "settings",
  "/plants": "plants",
  "/plants/new": "plantsNew",
};

/** Returns the `navigation.pageHeadings` key for a given (already locale-stripped) pathname, or null if it isn't a known customer route. */
export function resolveCustomerPageHeadingKey(pathname: string): string | null {
  const staticMatch = CUSTOMER_ROUTE_KEYS[pathname];
  if (staticMatch) {
    return staticMatch;
  }

  // /plants/[id] and /plants/[id]/edit - the only dynamic-segment customer routes.
  if (/^\/plants\/[^/]+\/edit$/.test(pathname)) {
    return "plantEdit";
  }
  if (/^\/plants\/[^/]+$/.test(pathname)) {
    return "plantDetails";
  }

  return null;
}
