"use server";

import { DayOfWeek, Prisma } from "@prisma/client";

import { ALL_DAYS_OF_WEEK } from "@/lib/automation/day-of-week";
import { DEFAULT_EXPORT_THRESHOLD_CONFIG } from "@/lib/automation/export-threshold-config";
import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

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

/** Drops anything not a real `DayOfWeek` value and de-duplicates - defense in depth against a hand-crafted request; the real UI only ever sends valid, unique values. */
function sanitizeEnabledDays(rawDays: string[]): DayOfWeek[] {
  return [...new Set(rawDays.filter((day): day is DayOfWeek => VALID_DAYS_OF_WEEK.has(day)))];
}

export type UpdateMarketPriceAutomationErrorCode = "enabledDaysRequired";

export type UpdateMarketPriceAutomationResult =
  | { ok: true }
  | { ok: false; code: UpdateMarketPriceAutomationErrorCode };

/**
 * The single place that writes AutomationSettings.automationEnabled /
 * minimumExportPrice / enabledDays - this Market Price Optimization card is
 * now the only UI that edits this row (previously duplicated on /settings,
 * removed there). `currency` and `energyTrader` are deliberately left out
 * of both the `create` and `update` payloads: `currency` falls back to the
 * schema's own "EUR" default on create and is never touched on update;
 * `energyTrader` stays whatever it already was (or null) - it's an
 * unrelated, not-yet-exposed field, and touching it here would silently
 * reset it every time this simplified form is saved.
 *
 * Weekly Day-of-Week Scheduling milestone: an enabled automation with zero
 * selected days would never execute (see `findEligibleOrganizations`'s own
 * `enabledDays: { has: today }` filter, which already makes that
 * combination inert on its own) - refused here too, as a UX-layer
 * validation, so that state is never silently saved and misread as "runs
 * every day" or left unexplained. `code` (not a raw string) matches
 * `settings/actions.ts`'s existing `ActionResultCode` convention - the
 * error message itself is resolved client-side via next-intl, never
 * hardcoded English here.
 */
export async function updateMarketPriceAutomation(input: {
  enabled: boolean;
  minimumExportPrice: string;
  enabledDays: string[];
}): Promise<UpdateMarketPriceAutomationResult> {
  const user = await requirePermission(Permissions.canManagePlants);

  const enabledDays = sanitizeEnabledDays(input.enabledDays);

  if (input.enabled && enabledDays.length === 0) {
    return { ok: false, code: "enabledDaysRequired" };
  }

  const minimumExportPrice = parseMinimumExportPrice(input.minimumExportPrice);

  await prisma.automationSettings.upsert({
    where: {
      organizationId: user.organizationId,
    },
    create: {
      organizationId: user.organizationId,
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
