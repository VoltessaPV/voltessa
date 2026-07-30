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
export function NoClientAssignedState() {
  return (
    <EmptyState
      title="No client selected"
      description="Select a client from the Clients page to see their data here."
    />
  );
}
