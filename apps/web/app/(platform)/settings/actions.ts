"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

const DEFAULT_MINIMUM_EXPORT_PRICE = "15.00";

function parseMinimumExportPrice(formData: FormData): Prisma.Decimal {
  const raw = formData.get("minimumExportPrice")?.toString().trim();

  if (!raw) {
    return new Prisma.Decimal(DEFAULT_MINIMUM_EXPORT_PRICE);
  }

  try {
    return new Prisma.Decimal(raw);
  } catch {
    return new Prisma.Decimal(DEFAULT_MINIMUM_EXPORT_PRICE);
  }
}

export async function updateAutomationSettings(formData: FormData) {
  const user = await requirePermission(Permissions.canManagePlants);

  const automationEnabled = formData.get("automationEnabled") === "on";
  const minimumExportPrice = parseMinimumExportPrice(formData);
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
      energyTrader,
    },
    update: {
      automationEnabled,
      minimumExportPrice,
      energyTrader,
    },
  });

  redirect("/settings");
}
