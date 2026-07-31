import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/platform/EmptyState";

/**
 * Trader Workspace milestone. Shared empty state for Automations/Alerts/
 * BESS when a Trader has no client selected (zero assignments - the only
 * way `organizationId` is ever null for these pages, since
 * `requireTraderOrganizationAccess()` auto-selects the most recently
 * assigned client whenever at least one exists). Never a redirect, never a
 * dead end - the trader can still use every other part of the workspace
 * (Dashboard, Clients, Market, Settings).
 */
export async function NoClientAssignedState() {
  const t = await getTranslations("shared.noClientAssigned");

  return <EmptyState title={t("title")} description={t("description")} />;
}
