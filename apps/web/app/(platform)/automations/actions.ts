"use server";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import {
  executeDiagnosticTest,
  findDiagnosticDefinition,
  getOrgHuaweiDiagnosticTargets,
  isTargetSupportedByDefinition,
  type DiagnosticParameterValues,
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
 * AND one of the types that definition declares support for (both
 * re-verified here, never trusted from the client — the client's own
 * Target-dropdown filtering is a UX convenience, not the security
 * boundary). `params` are the definition's declared extra inputs
 * (`taskId`, `collectTime`, ...); missing a required one is rejected here
 * too, not just left to Huawei to reject.
 */
export async function runHuaweiDiagnosticTest(
  testId: string,
  targetKey: string,
  params: DiagnosticParameterValues,
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

  if (!isTargetSupportedByDefinition(definition, target)) {
    return {
      ok: false,
      error: `"${definition.label}" does not support a target of type "${target.deviceType}"`,
    };
  }

  const missingParam = definition.parameters.find(
    (param) => param.required && !params[param.name]?.trim(),
  );

  if (missingParam) {
    return {
      ok: false,
      error: `Missing required parameter "${missingParam.label}"`,
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

  const result = await executeDiagnosticTest(
    connection,
    definition,
    target,
    params,
  );

  return { ok: true, result };
}

/**
 * TEMPORARY diagnostic — root-causing a report that the Target dropdown
 * only shows "Plant (Atlanta)" in production. The client component calls
 * this once on mount with exactly the props/derived state it has in the
 * browser, so the real browser-side values show up in Vercel's server
 * logs (console.log inside a Server Action is captured there) without
 * requiring anyone to manually copy browser DevTools output. Remove once
 * understood — this performs no Huawei call and changes nothing.
 */
export async function reportDiagnosticClientState(payload: {
  stage: string;
  count: number;
  items: Array<{ kind: string; deviceType: string; key: string; label: string }>;
}): Promise<void> {
  console.log(`[DiagTargets][${payload.stage}]`, {
    count: payload.count,
    items: payload.items,
  });
}
