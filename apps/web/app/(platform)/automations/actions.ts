"use server";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import {
  executeDiagnosticTest,
  findDiagnosticDefinition,
  getOrgHuaweiDiagnosticTargets,
  type DiagnosticTestResult,
} from "@/lib/fusionsolar/diagnostic-tests";
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

export type DiagnosticTestActionResult =
  | { ok: true; result: DiagnosticTestResult }
  | { ok: false; error: string };

/**
 * Huawei Diagnostic Tests section (Automations page): runs exactly one
 * Huawei API call per invocation, via the shared `executeDiagnosticTest`
 * executor. `testId` selects a definition from `DIAGNOSTIC_DEFINITIONS`;
 * `targetKey` must be one of this organization's own Plant/Device targets
 * (re-verified here, never trusted from the client) — never a
 * client-supplied path or body.
 */
export async function runHuaweiDiagnosticTest(
  testId: string,
  targetKey: string,
): Promise<DiagnosticTestActionResult> {
  const user = await requirePermission(Permissions.canOperatePlants);

  const definition = findDiagnosticDefinition(testId);

  if (!definition) {
    return { ok: false, error: "Unknown diagnostic test" };
  }

  const targets = await getOrgHuaweiDiagnosticTargets(user.organizationId);
  const target = targets?.targets.find(
    (candidate) => candidate.key === targetKey,
  );

  if (!target) {
    return {
      ok: false,
      error: "Target does not belong to this organization's Huawei plant",
    };
  }

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: user.organizationId,
        provider: "HuaweiFusionSolar",
      },
    },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      tokenType: true,
      scope: true,
      expiresAt: true,
    },
  });

  if (!connection) {
    return { ok: false, error: "FusionSolar connection not found" };
  }

  const result = await executeDiagnosticTest(connection, definition, target);

  return { ok: true, result };
}
