import { DayOfWeek, Prisma } from "@prisma/client";

import { ALL_DAYS_OF_WEEK } from "@/lib/automation/day-of-week";
import { DEFAULT_EXPORT_THRESHOLD_CONFIG } from "@/lib/automation/export-threshold-config";
import { prisma } from "@/lib/prisma";

/**
 * Mobile Client Architecture (ADR-020), M4. Extracted, verbatim, from
 * `app/[locale]/(platform)/automations/actions.ts`'s
 * `updateMarketPriceAutomation` - the exact same
 * sanitize/validate/upsert logic, now callable from both the existing Web
 * Server Action (which still resolves the caller via
 * `requirePermission(Permissions.canManagePlants)` and just forwards its
 * `organizationId` here, unchanged behavior) and a new Mobile Route
 * Handler, per ADR-020's "Feature parity" rule: business logic is written
 * once, as a plain function taking explicit inputs, never reading
 * cookies/session internally.
 */

function parseMinimumExportPrice(raw: string): Prisma.Decimal {
  const trimmed = raw.trim();

  if (!trimmed) {
    return new Prisma.Decimal(DEFAULT_EXPORT_THRESHOLD_CONFIG.minimumExportPrice);
  }

  try {
    return new Prisma.Decimal(trimmed);
  } catch {
    return new Prisma.Decimal(DEFAULT_EXPORT_THRESHOLD_CONFIG.minimumExportPrice);
  }
}

const VALID_DAYS_OF_WEEK = new Set<string>(ALL_DAYS_OF_WEEK);

/** Drops anything not a real `DayOfWeek` value and de-duplicates - defense in depth against a hand-crafted request. */
function sanitizeEnabledDays(rawDays: string[]): DayOfWeek[] {
  return [...new Set(rawDays.filter((day): day is DayOfWeek => VALID_DAYS_OF_WEEK.has(day)))];
}

export type UpdateMarketPriceAutomationErrorCode = "enabledDaysRequired";

export type UpdateMarketPriceAutomationResult =
  | { ok: true }
  | { ok: false; code: UpdateMarketPriceAutomationErrorCode };

/**
 * The single place that writes AutomationSettings.automationEnabled /
 * minimumExportPrice / enabledDays. `currency` and `energyTrader` are
 * deliberately left out of both the `create` and `update` payloads - see
 * this module's own history in `automations/actions.ts` for why
 * (`currency` falls back to the schema's own default and is never
 * touched on update; `energyTrader` stays whatever it already was).
 */
export async function updateMarketPriceAutomationForOrganization(input: {
  organizationId: string;
  enabled: boolean;
  minimumExportPrice: string;
  enabledDays: string[];
}): Promise<UpdateMarketPriceAutomationResult> {
  const enabledDays = sanitizeEnabledDays(input.enabledDays);

  if (input.enabled && enabledDays.length === 0) {
    return { ok: false, code: "enabledDaysRequired" };
  }

  const minimumExportPrice = parseMinimumExportPrice(input.minimumExportPrice);

  await prisma.automationSettings.upsert({
    where: {
      organizationId: input.organizationId,
    },
    create: {
      organizationId: input.organizationId,
      automationEnabled: input.enabled,
      minimumExportPrice,
      enabledDays,
    },
    update: {
      automationEnabled: input.enabled,
      minimumExportPrice,
      enabledDays,
    },
  });

  return { ok: true };
}
