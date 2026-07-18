"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";

import { DEFAULT_EXPORT_THRESHOLD_CONFIG } from "@/lib/automation/export-threshold-config";
import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

function parseMinimumExportPrice(formData: FormData): Prisma.Decimal {
  const raw = formData.get("minimumExportPrice")?.toString().trim();

  if (!raw) {
    return new Prisma.Decimal(DEFAULT_EXPORT_THRESHOLD_CONFIG.minimumExportPrice);
  }

  try {
    return new Prisma.Decimal(raw);
  } catch {
    return new Prisma.Decimal(DEFAULT_EXPORT_THRESHOLD_CONFIG.minimumExportPrice);
  }
}

function parseCurrency(formData: FormData): string {
  const raw = formData.get("currency")?.toString().trim().toUpperCase();

  return raw || DEFAULT_EXPORT_THRESHOLD_CONFIG.currency;
}

export async function updateAutomationSettings(formData: FormData) {
  const user = await requirePermission(Permissions.canManagePlants);

  const automationEnabled = formData.get("automationEnabled") === "on";
  const minimumExportPrice = parseMinimumExportPrice(formData);
  const currency = parseCurrency(formData);
  const energyTrader =
    formData.get("energyTrader")?.toString().trim() || null;

  await prisma.automationSettings.upsert({
    where: {
      organizationId: user.organizationId,
    },
    create: {
      organizationId: user.organizationId,
      automationEnabled,
      minimumExportPrice,
      currency,
      energyTrader,
    },
    update: {
      automationEnabled,
      minimumExportPrice,
      currency,
      energyTrader,
    },
  });

  redirect("/settings");
}
