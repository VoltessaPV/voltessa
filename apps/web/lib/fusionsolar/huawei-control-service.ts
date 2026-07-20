import type { FusionSolarConnection } from "@/lib/fusionsolar/api-client";
import { FusionSolarApiError } from "@/lib/fusionsolar/api-client";
import {
  restoreExport,
  setExportLimit,
  type ActivePowerControlDispatchResult,
} from "@/lib/fusionsolar/export-control";
import { prisma } from "@/lib/prisma";

/**
 * Huawei Control (Testing) milestone: a thin, logging-heavy wrapper around
 * `export-control.ts`'s `setExportLimit`/`restoreExport` - it does NOT
 * reimplement the Huawei request (that file remains the single source of
 * truth for the tasks/controlMode/controlInfo shape), only resolves
 * which plant/connection to send it to and records exactly what was sent
 * and what came back, since this is the first real exercise of code that
 * was previously never wired to anything.
 *
 * Deliberately manual-only: no scheduler, no automation, no polling. A
 * button click is the only way any of this runs.
 */

export type HuaweiControlResult = { ok: true } | { ok: false; error: string };

type HuaweiControlMode = "no-limit" | "zero-export";

type ControllablePlant = {
  id: string;
  name: string;
  plantCode: string;
};

async function findControllablePlant(
  organizationId: string,
  plantId: string,
): Promise<{ plant: ControllablePlant; connection: FusionSolarConnection }> {
  const [plant, connection] = await Promise.all([
    prisma.plant.findFirst({
      where: {
        id: plantId,
        organizationId,
        vendor: "Huawei",
        plantCode: { not: null },
      },
      select: {
        id: true,
        name: true,
        plantCode: true,
      },
    }),
    prisma.fusionSolarConnection.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
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
    }),
  ]);

  if (!plant?.plantCode) {
    throw new Error("plant_not_found");
  }

  if (!connection) {
    throw new Error("fusionsolar_connection_not_found");
  }

  return {
    plant: { id: plant.id, name: plant.name, plantCode: plant.plantCode },
    connection,
  };
}

/**
 * Mirrors the exact request `setExportLimit`/`restoreExport` will send (see
 * export-control.ts's `deliverActivePowerControlTask`) purely for logging -
 * this does not construct or send anything itself.
 */
function describeRequest(mode: HuaweiControlMode, plantCode: string) {
  return mode === "no-limit"
    ? { plantCode, controlMode: "0 (UNLIMITED)" }
    : {
        plantCode,
        controlMode: "6 (LIMITED_FEED_IN)",
        controlInfo: { maxGridFeedInPower: 0, limitationMode: 0 },
      };
}

async function dispatchControlCommand(
  mode: HuaweiControlMode,
  plantId: string,
  organizationId: string,
): Promise<HuaweiControlResult> {
  const logContext = { mode, plantId, organizationId };

  let plant: ControllablePlant;
  let connection: FusionSolarConnection;

  try {
    ({ plant, connection } = await findControllablePlant(
      organizationId,
      plantId,
    ));
  } catch (error) {
    console.error("[Huawei Control] Plant/connection lookup failed", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });

    return { ok: false, error: "Plant or FusionSolar connection not found" };
  }

  const startedAt = Date.now();

  console.log("[Huawei Control] Sending request", {
    ...logContext,
    plantName: plant.name,
    request: describeRequest(mode, plant.plantCode),
  });

  try {
    const dispatch: ActivePowerControlDispatchResult =
      mode === "no-limit"
        ? await restoreExport(connection, plant.plantCode)
        : await setExportLimit(connection, plant.plantCode, 0);

    console.log("[Huawei Control] Response received", {
      ...logContext,
      plantName: plant.name,
      durationMs: Date.now() - startedAt,
      // export-control.ts's functions return only the unwrapped response
      // body (by design - see that file), so the exact upstream HTTP
      // status isn't available here on the success path; reaching this
      // branch at all means it was 2xx (callFusionSolarApi throws
      // otherwise - see the catch block below for the failure case, where
      // the real status IS available).
      httpStatus: "2xx (success - exact code not exposed on the success path)",
      response: dispatch,
    });

    return { ok: true };
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    if (error instanceof FusionSolarApiError) {
      console.error("[Huawei Control] Huawei rejected the command", {
        ...logContext,
        plantName: plant.name,
        durationMs,
        httpStatus: error.httpStatus,
        failCode: error.failCode,
        message: error.message,
        response: error.response,
      });

      return { ok: false, error: error.message };
    }

    console.error("[Huawei Control] Unexpected error dispatching command", {
      ...logContext,
      plantName: plant.name,
      durationMs,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    });

    return { ok: false, error: "Unexpected error contacting FusionSolar" };
  }
}

/** Restores unlimited grid export ("No Limit"). */
export async function setNoLimit(
  plantId: string,
  organizationId: string,
): Promise<HuaweiControlResult> {
  return dispatchControlCommand("no-limit", plantId, organizationId);
}

/** Limits grid export to 0 kW ("Zero Export"). */
export async function setZeroExport(
  plantId: string,
  organizationId: string,
): Promise<HuaweiControlResult> {
  return dispatchControlCommand("zero-export", plantId, organizationId);
}
