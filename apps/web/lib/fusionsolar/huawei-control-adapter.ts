import type {
  AutomationPayload,
  AutomationType,
  CanonicalAutomationResult,
  ManufacturerControlAdapter,
} from "@/lib/automation/manufacturer-control-adapter";
import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import {
  executeDiagnosticTest,
  findDiagnosticDefinition,
  type DiagnosticTarget,
} from "@/lib/fusionsolar/diagnostic-tests";
import { prisma } from "@/lib/prisma";
import { INVERTER_DEV_TYPE_ID } from "@/lib/telemetry/queries";

/**
 * Huawei's `ManufacturerControlAdapter` (ADR-018) — the first, not the
 * only, implementation. Every automation below is dispatched through the
 * exact same generic executor (`executeDiagnosticTest`) the existing
 * internal Huawei diagnostics console (`app/dev/huawei-api`) already uses —
 * no second Huawei-calling implementation, no new HTTP logic. This module's
 * only job is resolving `plantId` into whatever `DiagnosticTarget` each
 * automation's registered `DiagnosticDefinition` needs.
 *
 * "Read inverter status" is the one automation with no existing plant-level
 * definition: `device-real-kpi` is defined for a single device target, but
 * Huawei's own endpoint already accepts every inverter's id in one
 * comma-joined request (confirmed by `get-plant-inverter-status.ts`'s
 * `getPlantInverterStatuses`, which does exactly this for the Dashboard's
 * Inverters card). Rather than duplicating that call, this constructs the
 * same kind of joined-id target `device-real-kpi` already knows how to
 * build a request from — no change to `diagnostic-tests.ts` needed.
 */

async function resolvePlant(plantId: string): Promise<{
  organizationId: string;
  plantCode: string;
} | null> {
  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    select: { organizationId: true, plantCode: true },
  });

  return plant?.plantCode ? { organizationId: plant.organizationId, plantCode: plant.plantCode } : null;
}

async function resolveConnection(organizationId: string): Promise<FusionSolarConnection | null> {
  return prisma.fusionSolarConnection.findUnique({
    where: { organizationId_provider: { organizationId, provider: "HuaweiFusionSolar" } },
    select: { id: true, accessToken: true, refreshToken: true, tokenType: true, scope: true, expiresAt: true },
  });
}

function plantTarget(plantCode: string): DiagnosticTarget {
  return {
    key: plantCode,
    label: "Plant",
    kind: "plant",
    deviceType: "plant",
    plantCode,
    devDn: null,
    huaweiDeviceId: null,
    devTypeId: null,
  };
}

/** Every inverter device id for the plant, comma-joined — see this file's top doc comment for why this is a valid `device-real-kpi` target. */
async function allInvertersTarget(plantId: string, plantCode: string): Promise<DiagnosticTarget | null> {
  const inverters = await prisma.device.findMany({
    where: { plantId, devTypeId: INVERTER_DEV_TYPE_ID, huaweiDeviceId: { not: null } },
    select: { huaweiDeviceId: true },
  });

  if (inverters.length === 0) {
    return null;
  }

  return {
    key: `${plantCode}::inverters`,
    label: "All inverters",
    kind: "device",
    deviceType: "inverter",
    plantCode,
    devDn: null,
    huaweiDeviceId: inverters.map((device) => device.huaweiDeviceId!.toString()).join(","),
    devTypeId: INVERTER_DEV_TYPE_ID,
  };
}

const DEFINITION_ID_BY_TYPE: Record<AutomationType, string> = {
  "read-inverter-status": "device-real-kpi",
  "read-export-config": "active-power-control-mode",
  "zero-export": "deliver-apc-task-zero-export",
  "remove-export-limit": "deliver-apc-task-no-limit",
  "set-export-limit": "deliver-apc-task-limited-feed-in",
};

async function execute(
  plantId: string,
  type: AutomationType,
  payload: AutomationPayload,
): Promise<CanonicalAutomationResult> {
  const plant = await resolvePlant(plantId);
  if (!plant) {
    throw new Error("Plant not found, or has no Huawei plantCode configured");
  }

  const connection = await resolveConnection(plant.organizationId);
  if (!connection) {
    throw new Error("No FusionSolar connection found for this plant's organization");
  }

  const definition = findDiagnosticDefinition(DEFINITION_ID_BY_TYPE[type]);
  if (!definition) {
    throw new Error(`No Huawei diagnostic definition registered for automation type "${type}"`);
  }

  const target =
    type === "read-inverter-status"
      ? await allInvertersTarget(plantId, plant.plantCode)
      : plantTarget(plant.plantCode);

  if (!target) {
    throw new Error("No inverter devices found for this plant");
  }

  const result = await executeDiagnosticTest(connection, definition, target, payload);

  return {
    requestBody: result.requestBody,
    responseBody: result.responseBody,
    durationMs: result.durationMs,
    httpStatus: result.httpStatus,
    vendorStatusCode: result.failCode,
    success: result.success,
    errors: result.success === false && result.message ? [result.message] : [],
    warnings: [],
  };
}

export const huaweiControlAdapter: ManufacturerControlAdapter = {
  vendor: "Huawei",
  execute,
};
