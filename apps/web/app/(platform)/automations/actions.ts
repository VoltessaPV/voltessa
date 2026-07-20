"use server";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import {
  setNoLimit,
  setZeroExport,
  type HuaweiControlResult,
} from "@/lib/fusionsolar/huawei-control-service";
import { prisma } from "@/lib/prisma";

/**
 * No plant picker exists yet (out of scope for this manual-testing
 * milestone) - resolves the org's one Huawei plant, same lookup the
 * FusionSolar active-power-control diagnostic route already uses.
 */
async function findOrgHuaweiPlantId(
  organizationId: string,
): Promise<string | null> {
  const plant = await prisma.plant.findFirst({
    where: {
      organizationId,
      vendor: "Huawei",
      plantCode: { not: null },
    },
    select: { id: true },
  });

  return plant?.id ?? null;
}

async function runHuaweiControlAction(
  dispatch: (
    plantId: string,
    organizationId: string,
  ) => Promise<HuaweiControlResult>,
): Promise<HuaweiControlResult> {
  const user = await requirePermission(Permissions.canOperatePlants);

  const plantId = await findOrgHuaweiPlantId(user.organizationId);

  if (!plantId) {
    return { ok: false, error: "No Huawei plant found for this organization" };
  }

  return dispatch(plantId, user.organizationId);
}

export async function sendHuaweiNoLimit(): Promise<HuaweiControlResult> {
  return runHuaweiControlAction(setNoLimit);
}

export async function sendHuaweiZeroExport(): Promise<HuaweiControlResult> {
  return runHuaweiControlAction(setZeroExport);
}
