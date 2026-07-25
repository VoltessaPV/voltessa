"use server";

import { Prisma } from "@prisma/client";

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

export type UpdateMarketPriceAutomationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * The single place that writes AutomationSettings.automationEnabled /
 * minimumExportPrice - this Market Price Optimization card is now the only
 * UI that edits this row (previously duplicated on /settings, removed
 * there). `currency` and `energyTrader` are deliberately left out of both
 * the `create` and `update` payloads: `currency` falls back to the
 * schema's own "EUR" default on create and is never touched on update;
 * `energyTrader` stays whatever it already was (or null) - it's an
 * unrelated, not-yet-exposed field, and touching it here would silently
 * reset it every time this simplified form is saved.
 */
export async function updateMarketPriceAutomation(input: {
  enabled: boolean;
  minimumExportPrice: string;
}): Promise<UpdateMarketPriceAutomationResult> {
  const user = await requirePermission(Permissions.canManagePlants);

  const minimumExportPrice = parseMinimumExportPrice(input.minimumExportPrice);

  await prisma.automationSettings.upsert({
    where: {
      organizationId: user.organizationId,
    },
    create: {
      organizationId: user.organizationId,
      automationEnabled: input.enabled,
      minimumExportPrice,
    },
    update: {
      automationEnabled: input.enabled,
      minimumExportPrice,
    },
  });

  return { ok: true };
}
