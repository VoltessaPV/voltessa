import {
  callFusionSolarApi,
  FusionSolarApiError,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";

/**
 * Huawei SmartPVMS Northbound "v1 configuration" API — read-only. Returns
 * the plant's current active power control configuration regardless of
 * whether it was set manually inside FusionSolar or via a third-party app.
 *
 * Endpoint confirmed directly against Huawei's Northbound API Reference
 * ("Configuration" chapter):
 *   POST /rest/openapi/pvms/nbi/v1/configuration/active-power-control-mode
 *
 * This is a distinct endpoint from the v2 "control" family used for
 * dispatching export-limit changes (see export-control.ts). That family is
 * write/task-based and can only read back the result of a task this
 * integration itself dispatched — it cannot see a manually-configured
 * state. This endpoint is the read-side counterpart that was missing.
 *
 * The five modes, three param objects, and the `limitationMode` field
 * below match the official Huawei documentation.
 */

const ACTIVE_POWER_CONTROL_MODE_PATH =
  "/rest/openapi/pvms/nbi/v1/configuration/active-power-control-mode";

export type LimitationMode = "totalPower" | "singlePhasePower";

export type ZeroExportLimitationParam = {
  limitationMode: LimitationMode;
};

export type LimitedPowerGridValueParam = {
  limitationMode: LimitationMode;
  maxGridFeedInPowerValue: number;
};

export type LimitedPowerGridPercentParam = {
  limitationMode: LimitationMode;
  maxGridFeedInPowerPercent: number;
};

export type ActivePowerControlModeNoLimit = {
  activePowerControlMode: "noLimit";
};

export type ActivePowerControlModeZeroExport = {
  activePowerControlMode: "zeroExportLimitation";
  zeroExportLimitationParam: ZeroExportLimitationParam;
};

export type ActivePowerControlModeLimitedKW = {
  activePowerControlMode: "limitedPowerGridKW";
  limitedPowerGridValueParam: LimitedPowerGridValueParam;
};

export type ActivePowerControlModeLimitedPercent = {
  activePowerControlMode: "limitedPowerGridPercent";
  limitedPowerGridPercentParam: LimitedPowerGridPercentParam;
};

export type ActivePowerControlModeOther = {
  activePowerControlMode: "other";
};

/**
 * The exact shape Huawei's endpoint returns on the wire, per the official
 * documentation. Not exported — only this module's parsing boundary
 * (`getActivePowerControlMode` below) should ever reference it directly,
 * so a future change to Huawei's wire shape only needs a change here, not
 * everywhere this module is consumed.
 */
type HuaweiActivePowerControlModeResponse =
  | ActivePowerControlModeNoLimit
  | ActivePowerControlModeZeroExport
  | ActivePowerControlModeLimitedKW
  | ActivePowerControlModeLimitedPercent
  | ActivePowerControlModeOther;

/**
 * The clean model this module hands to the rest of the app. Structurally
 * identical to the wire shape today (Huawei's documented fields are
 * already clean) — callers should depend on this exported name, not on
 * `callFusionSolarApi`'s transport envelope, which is why this is a
 * distinct type rather than the network call's generic argument directly.
 */
export type ActivePowerControlModeResult =
  HuaweiActivePowerControlModeResponse;

/**
 * Reads the current active power control mode for a single plant. Never
 * writes anything — this is the read-only counterpart to the (unwired,
 * manually-tested-only) helpers in export-control.ts.
 */
export async function getActivePowerControlMode(
  connection: FusionSolarConnection,
  plantCode: string,
): Promise<ActivePowerControlModeResult> {
  const requestBody = { plantCode };

  // TEMPORARY diagnostic logging — remove once the upstream HTTP 400 is
  // understood. Does not change the request being sent or any error
  // handling below; only observes and re-throws unchanged.
  console.log("[FusionSolar Diagnostic] Active power control mode request", {
    path: ACTIVE_POWER_CONTROL_MODE_PATH,
    plantCode,
    body: requestBody,
  });

  try {
    const result =
      await callFusionSolarApi<HuaweiActivePowerControlModeResponse>(
        connection,
        {
          path: ACTIVE_POWER_CONTROL_MODE_PATH,
          body: requestBody,
        },
      );

    return result.data;
  } catch (error) {
    if (error instanceof FusionSolarApiError) {
      const response = error.response;
      const parsedJson =
        response && typeof response === "object"
          ? (response as {
              success?: boolean;
              failCode?: number;
              message?: string | null;
            })
          : null;

      // TEMPORARY diagnostic logging — see comment above.
      console.error(
        "[FusionSolar Diagnostic] Active power control mode upstream error",
        {
          httpStatus: error.httpStatus,
          headers: error.headers,
          responseBody: error.response,
          success: parsedJson?.success ?? null,
          failCode: parsedJson?.failCode ?? error.failCode,
          message: parsedJson?.message ?? error.message,
        },
      );
    }

    throw error;
  }
}
