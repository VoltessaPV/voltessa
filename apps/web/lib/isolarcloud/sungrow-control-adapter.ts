import type {
  AutomationPayload,
  AutomationType,
  CanonicalAutomationResult,
  ManufacturerControlAdapter,
} from "@/lib/automation/manufacturer-control-adapter";
import { findSungrowConnection, type SungrowConnection } from "@/lib/isolarcloud/api-client";
import { SUNGROW_DEVICE_TYPE } from "@/lib/isolarcloud/devices";
import {
  getSungrowParamSettingTaskStatus,
  readSungrowExportLimit,
  restoreSungrowExport,
  setSungrowExportLimit,
} from "@/lib/isolarcloud/grid-control";
import { getSungrowPlantCurrentPowerStatus } from "@/lib/isolarcloud/get-plant-power-status";
import { prisma } from "@/lib/prisma";

/**
 * Sungrow's `ManufacturerControlAdapter` (ADR-018) — the second
 * implementation alongside `huaweiControlAdapter`
 * (`lib/fusionsolar/huawei-control-adapter.ts`), which this mirrors in
 * shape (resolve plant -> resolve connection -> resolve target -> execute).
 * `zero-export`/`set-export-limit`/`remove-export-limit` all route through
 * `grid-control.ts`'s verified-device-type gate — see that module's top
 * doc comment. This adapter does not itself decide capability; it only
 * surfaces whatever `grid-control.ts` decides, exactly like
 * `AutomationService.execute` lets adapter errors propagate uncaught
 * (see `lib/automation/automation-service.ts`).
 */

const READ_TASK_POLL_ATTEMPTS = 5;
const READ_TASK_POLL_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolvePlant(
  plantId: string,
): Promise<{ organizationId: string; psId: string } | null> {
  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    select: { organizationId: true, stationCode: true },
  });

  return plant?.stationCode ? { organizationId: plant.organizationId, psId: plant.stationCode } : null;
}

async function resolveConnection(organizationId: string): Promise<SungrowConnection | null> {
  return findSungrowConnection(organizationId);
}

/** The plant's primary inverter device — grid-control operations target a single device. */
async function resolvePrimaryInverter(
  plantId: string,
): Promise<{ uuid: string; deviceType: number } | null> {
  const device = await prisma.device.findFirst({
    where: { plantId, devTypeId: SUNGROW_DEVICE_TYPE.INVERTER },
    select: { devDn: true, devTypeId: true },
  });

  return device ? { uuid: device.devDn, deviceType: device.devTypeId } : null;
}

async function execute(
  plantId: string,
  type: AutomationType,
  payload: AutomationPayload,
): Promise<CanonicalAutomationResult> {
  const startedAt = Date.now();

  const plant = await resolvePlant(plantId);
  if (!plant) {
    throw new Error("Plant not found, or has no Sungrow station id configured");
  }

  const connection = await resolveConnection(plant.organizationId);
  if (!connection) {
    throw new Error("No Sungrow connection found for this plant's organization");
  }

  if (type === "read-inverter-status") {
    const status = await getSungrowPlantCurrentPowerStatus(connection, plant.psId);

    return {
      requestBody: { psId: plant.psId },
      responseBody: status,
      durationMs: Date.now() - startedAt,
      httpStatus: null,
      vendorStatusCode: null,
      success: status.currentProduction.available,
      errors: [],
      warnings: status.currentProduction.available ? [] : ["Sungrow real-time power data unavailable"],
    };
  }

  const inverter = await resolvePrimaryInverter(plantId);
  if (!inverter) {
    throw new Error("No inverter device found for this Sungrow plant");
  }

  if (type === "read-export-config") {
    const { taskId } = await readSungrowExportLimit(connection, inverter.uuid);

    let status: Awaited<ReturnType<typeof getSungrowParamSettingTaskStatus>> | null = null;
    for (let attempt = 0; attempt < READ_TASK_POLL_ATTEMPTS; attempt += 1) {
      status = await getSungrowParamSettingTaskStatus(connection, inverter.uuid, taskId);
      if (status.status !== "RUNNING") {
        break;
      }
      await sleep(READ_TASK_POLL_DELAY_MS);
    }

    return {
      requestBody: { uuid: inverter.uuid, taskId },
      responseBody: status,
      durationMs: Date.now() - startedAt,
      httpStatus: null,
      vendorStatusCode: null,
      success: status?.status === "SUCCESS",
      errors: status?.status === "FAIL" ? ["Sungrow reported the read task failed"] : [],
      warnings: status?.status === "RUNNING" ? ["Task still running after poll budget"] : [],
    };
  }

  // zero-export / set-export-limit / remove-export-limit — all gated by
  // grid-control.ts's SUNGROW_EXPORT_LIMIT_VERIFIED_DEVICE_TYPES allowlist,
  // currently empty. These calls are expected to throw
  // SungrowGridControlUnverifiedError until that allowlist is deliberately
  // populated after real verification.
  if (type === "zero-export") {
    const { taskId } = await setSungrowExportLimit(connection, inverter, 0);
    return {
      requestBody: { uuid: inverter.uuid, maxFeedInPowerKw: 0 },
      responseBody: { taskId },
      durationMs: Date.now() - startedAt,
      httpStatus: null,
      vendorStatusCode: null,
      success: null,
      errors: [],
      warnings: ["Dispatched — not yet confirmed by a task-status poll"],
    };
  }

  if (type === "set-export-limit") {
    const maxFeedInPowerKw = Number(payload.maxFeedInPowerKw ?? payload.maxGridFeedInPowerKw ?? "");
    if (!Number.isFinite(maxFeedInPowerKw)) {
      throw new Error("set-export-limit requires a numeric maxFeedInPowerKw payload field");
    }

    const { taskId } = await setSungrowExportLimit(connection, inverter, maxFeedInPowerKw);
    return {
      requestBody: { uuid: inverter.uuid, maxFeedInPowerKw },
      responseBody: { taskId },
      durationMs: Date.now() - startedAt,
      httpStatus: null,
      vendorStatusCode: null,
      success: null,
      errors: [],
      warnings: ["Dispatched — not yet confirmed by a task-status poll"],
    };
  }

  // remove-export-limit
  const { taskId } = await restoreSungrowExport(connection, inverter);
  return {
    requestBody: { uuid: inverter.uuid },
    responseBody: { taskId },
    durationMs: Date.now() - startedAt,
    httpStatus: null,
    vendorStatusCode: null,
    success: null,
    errors: [],
    warnings: ["Dispatched — not yet confirmed by a task-status poll"],
  };
}

export const sungrowControlAdapter: ManufacturerControlAdapter = {
  vendor: "Sungrow",
  execute,
};
