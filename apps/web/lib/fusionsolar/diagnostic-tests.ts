import {
  callFusionSolarApi,
  FusionSolarApiError,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";
import { prisma } from "@/lib/prisma";

/**
 * Generic Huawei API diagnostic framework backing the Automations page's
 * "Huawei Diagnostic Tests" section. The framework knows nothing about any
 * specific Huawei endpoint (Active Power Control or otherwise) — it only
 * knows how to: discover targets (the org's Plant + Devices), run a
 * registered `DiagnosticDefinition` against a chosen target, and report the
 * result. Every concrete Huawei endpoint this can call is just one entry in
 * `DIAGNOSTIC_DEFINITIONS` — adding another endpoint later means adding one
 * entry here, nothing else (no UI/component change, no framework change).
 *
 * Engineering diagnostics only, same class as `app/api/diag/fusionsolar-*`
 * — not a production feature.
 */

export type DiagnosticTargetKind = "plant" | "device";

export type DiagnosticDeviceType =
  | "plant"
  | "inverter"
  | "meter"
  | "smart-dongle"
  | string;

/**
 * One selectable entry in the Target dropdown. Carries every raw
 * identifying field Huawei's various endpoints ask for (a plant-scoped
 * `plantCode`/`stationCodes`, a device DN, a numeric Huawei device id, a
 * devTypeId) so any definition's `buildRequestBody` can pick whichever
 * field it needs — the framework itself does not interpret these fields.
 */
export type DiagnosticTarget = {
  /** Stable value used to re-look-up this exact target server-side. */
  key: string;
  label: string;
  kind: DiagnosticTargetKind;
  deviceType: DiagnosticDeviceType;
  plantCode: string;
  devDn: string | null;
  huaweiDeviceId: string | null;
  devTypeId: number | null;
};

/**
 * A single diagnostic test. `buildRequestBody` and the optional
 * `parseResponse` are the only endpoint-specific pieces — everything else
 * (timing, error capture, result shape) lives in `executeDiagnosticTest`
 * below and is shared by every definition.
 */
export type DiagnosticDefinition = {
  id: string;
  label: string;
  endpoint: string;
  buildRequestBody: (target: DiagnosticTarget) => Record<string, unknown>;
  /** Optional: normalizes the raw success payload for easier reading. The raw payload is always kept and shown regardless. */
  parseResponse?: (raw: unknown) => unknown;
};

export const DIAGNOSTIC_DEFINITIONS: DiagnosticDefinition[] = [
  {
    id: "active-power-control-mode",
    label: "Query Active Power Control Mode",
    endpoint:
      "/rest/openapi/pvms/nbi/v1/configuration/active-power-control-mode",
    buildRequestBody: (target) => ({
      plantCode: target.devDn ?? target.plantCode,
    }),
  },
];

export function findDiagnosticDefinition(
  testId: string,
): DiagnosticDefinition | null {
  return (
    DIAGNOSTIC_DEFINITIONS.find((definition) => definition.id === testId) ??
    null
  );
}

function deviceTypeLabel(devTypeId: number): DiagnosticDeviceType {
  if (devTypeId === 1) return "inverter";
  if (devTypeId === 47) return "meter";
  if (devTypeId === 62) return "smart-dongle";
  return `devTypeId-${devTypeId}`;
}

/**
 * The organization's Huawei plant plus every target a diagnostic test can
 * run against: the plant itself, plus every synced device. Shared between
 * the page (populating the Target dropdown) and the server action
 * (re-verifying a client-supplied target key actually belongs to this
 * organization before ever calling Huawei with it) — never hardcodes a
 * specific plant.
 */
export async function getOrgHuaweiDiagnosticTargets(
  organizationId: string,
): Promise<{
  plantId: string;
  plantName: string;
  targets: DiagnosticTarget[];
} | null> {
  const plant = await prisma.plant.findFirst({
    where: {
      organizationId,
      vendor: "Huawei",
      plantCode: { not: null },
    },
    select: { id: true, name: true, plantCode: true },
  });

  if (!plant?.plantCode) {
    return null;
  }

  const plantCode = plant.plantCode;

  const devices = await prisma.device.findMany({
    where: { plantId: plant.id },
    orderBy: [{ devTypeId: "asc" }, { devName: "asc" }],
    select: { devDn: true, devName: true, devTypeId: true, huaweiDeviceId: true },
  });

  const targets: DiagnosticTarget[] = [
    {
      key: plantCode,
      label: `Plant (${plant.name})`,
      kind: "plant",
      deviceType: "plant",
      plantCode,
      devDn: null,
      huaweiDeviceId: null,
      devTypeId: null,
    },
    ...devices.map((device) => ({
      key: device.devDn,
      label: `${deviceTypeLabel(device.devTypeId)} — ${device.devName}`,
      kind: "device" as const,
      deviceType: deviceTypeLabel(device.devTypeId),
      plantCode,
      devDn: device.devDn,
      huaweiDeviceId: device.huaweiDeviceId?.toString() ?? null,
      devTypeId: device.devTypeId,
    })),
  ];

  return { plantId: plant.id, plantName: plant.name, targets };
}

export type DiagnosticTestResult = {
  testId: string;
  testLabel: string;
  targetKey: string;
  targetLabel: string;
  deviceType: DiagnosticDeviceType;
  endpoint: string;
  requestBody: Record<string, unknown>;
  timestamp: string;
  durationMs: number;
  httpStatus: number | null;
  success: boolean | null;
  failCode: number | null;
  message: string | null;
  responseBody: unknown;
  parsedResult: unknown;
};

/**
 * The single shared executor every diagnostic test runs through, regardless
 * of which Huawei endpoint it calls. Only `definition.endpoint` /
 * `buildRequestBody` / `parseResponse` vary — timing, error handling, and
 * the result shape are identical for every test, present and future. One
 * call in, one Huawei request out: no batching, no retries, no loops.
 */
export async function executeDiagnosticTest(
  connection: FusionSolarConnection,
  definition: DiagnosticDefinition,
  target: DiagnosticTarget,
): Promise<DiagnosticTestResult> {
  const requestBody = definition.buildRequestBody(target);
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();

  try {
    const result = await callFusionSolarApi<unknown>(connection, {
      path: definition.endpoint,
      body: requestBody,
    });

    return {
      testId: definition.id,
      testLabel: definition.label,
      targetKey: target.key,
      targetLabel: target.label,
      deviceType: target.deviceType,
      endpoint: definition.endpoint,
      requestBody,
      timestamp,
      durationMs: Date.now() - startedAt,
      httpStatus: 200,
      success: true,
      failCode: null,
      message: null,
      responseBody: result.data,
      parsedResult: definition.parseResponse
        ? definition.parseResponse(result.data)
        : null,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    if (error instanceof FusionSolarApiError) {
      const parsed =
        error.response && typeof error.response === "object"
          ? (error.response as {
              success?: boolean;
              failCode?: number;
              message?: string | null;
            })
          : null;

      return {
        testId: definition.id,
        testLabel: definition.label,
        targetKey: target.key,
        targetLabel: target.label,
        deviceType: target.deviceType,
        endpoint: definition.endpoint,
        requestBody,
        timestamp,
        durationMs,
        httpStatus: error.httpStatus,
        success: parsed?.success ?? false,
        failCode: parsed?.failCode ?? error.failCode,
        message: parsed?.message ?? error.message,
        responseBody: error.response,
        parsedResult: null,
      };
    }

    return {
      testId: definition.id,
      testLabel: definition.label,
      targetKey: target.key,
      targetLabel: target.label,
      deviceType: target.deviceType,
      endpoint: definition.endpoint,
      requestBody,
      timestamp,
      durationMs,
      httpStatus: null,
      success: null,
      failCode: null,
      message: error instanceof Error ? error.message : String(error),
      responseBody: null,
      parsedResult: null,
    };
  }
}
