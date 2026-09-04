"use server";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { updateMarketPriceAutomationForOrganization } from "@/lib/automation/update-market-price-automation";

export type {
  UpdateMarketPriceAutomationErrorCode,
  UpdateMarketPriceAutomationResult,
} from "@/lib/automation/update-market-price-automation";

/**
 * Thin Web wrapper (M4/ADR-020 follow-up): the actual sanitize/validate/
 * upsert logic now lives in
 * `lib/automation/update-market-price-automation.ts`'s
 * `updateMarketPriceAutomationForOrganization`, shared with the new Mobile
 * Route Handler - this Server Action's only remaining job is resolving
 * the caller via the existing cookie-based
 * `requirePermission(Permissions.canManagePlants)` and forwarding its
 * `organizationId`. Behavior is unchanged: same permission check, same
 * validation, same upsert, same result shape.
 */
export async function updateMarketPriceAutomation(input: {
  enabled: boolean;
  minimumExportPrice: string;
  enabledDays: string[];
}) {
  const user = await requirePermission(Permissions.canManagePlants);

  return updateMarketPriceAutomationForOrganization({
    organizationId: user.organizationId,
    ...input,
  });
}
