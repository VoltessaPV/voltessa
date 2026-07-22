import {
  callFusionSolarApi,
  FusionSolarApiError,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";
import { prisma } from "@/lib/prisma";

/**
 * Generic, read-only Huawei API diagnostic framework backing the
 * Automations page's "Huawei Diagnostic Tests" section. Each entry in
 * `DIAGNOSTIC_TEST_DEFINITIONS` describes exactly one Huawei endpoint; the
 * UI generates one button per (definition x identifier) pair from the
 * organization's real `Plant`/`Device` rows, never a hardcoded plant name.
 * Adding a new Huawei endpoint to test later means adding one entry to
 * `DIAGNOSTIC_TEST_DEFINITIONS` — everything else (identifier discovery,
 * execution, timing, result shape) is already shared.
 *
 * Engineering diagnostics only, same class as `app/api/diag/fusionsolar-*`
 * — not a production feature. Every definition here must be read-only; the
 * shared executor (`executeDiagnosticTest`) only ever calls
 * `callFusionSolarApi` directly, never anything from `export-control.ts`.
 */

export type DiagnosticTestDefinition = {
  id: string;
  label: string;
  path: string;
  buildRequestBody: (identifier: string) => Record<string, unknown>;
};

export const DIAGNOSTIC_TEST_DEFINITIONS: DiagnosticTestDefinition[] = [
  {
    id: "active-power-control-mode",
    label: "Query Active Power Control Mode",
    path: "/rest/openapi/pvms/nbi/v1/configuration/active-power-control-mode",
    buildRequestBody: (identifier) => ({ plantCode: identifier }),
  },
];

export function findDiagnosticTestDefinition(
  testId: string,
): DiagnosticTestDefinition | null {
  return (
    DIAGNOSTIC_TEST_DEFINITIONS.find(
      (definition) => definition.id === testId,
    ) ?? null
  );
}

export type DiagnosticDeviceType =
  | "plant"
  | "inverter"
  | "meter"
  | "smart-dongle"
  | string;

export type DiagnosticIdentifier = {
  label: string;
  identifier: string;
  deviceType: DiagnosticDeviceType;
};

function deviceTypeLabel(devTypeId: number): DiagnosticDeviceType {
  if (devTypeId === 1) return "inverter";
  if (devTypeId === 47) return "meter";
  if (devTypeId === 62) return "smart-dongle";
  return `devTypeId-${devTypeId}`;
}

/**
 * The organization's Huawei plant plus every identifier a diagnostic test
 * can target: the plant's own DN, plus every synced device's DN. Shared
 * between the page (rendering one button per identifier) and the server
 * action (verifying a client-supplied identifier actually belongs to this
 * organization before ever calling Huawei with it) — never hardcodes a
 * specific plant.
 */
export async function getOrgHuaweiDiagnosticTargets(
  organizationId: string,
): Promise<{
  plantId: string;
  plantName: string;
  identifiers: DiagnosticIdentifier[];
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

  const devices = await prisma.device.findMany({
    where: { plantId: plant.id },
    orderBy: [{ devTypeId: "asc" }, { devName: "asc" }],
    select: { devDn: true, devName: true, devTypeId: true },
  });

  const identifiers: DiagnosticIdentifier[] = [
    {
      label: `Plant (${plant.name})`,
      identifier: plant.plantCode,
      deviceType: "plant",
    },
    ...devices.map((device) => ({
      label: `${deviceTypeLabel(device.devTypeId)} — ${device.devName}`,
      identifier: device.devDn,
      deviceType: deviceTypeLabel(device.devTypeId),
    })),
  ];

  return { plantId: plant.id, plantName: plant.name, identifiers };
}

export type DiagnosticTestResult = {
  testId: string;
  testLabel: string;
  identifier: string;
  identifierLabel: string;
  deviceType: DiagnosticDeviceType;
  requestPath: string;
  requestBody: Record<string, unknown>;
  timestamp: string;
  durationMs: number;
  httpStatus: number | null;
  success: boolean | null;
  failCode: number | null;
  message: string | null;
  responseBody: unknown;
};

/**
 * The single shared executor every diagnostic button calls through. Only
 * `definition.path`/`definition.buildRequestBody` vary per test — timing,
 * error handling, and the result shape are identical for every test,
 * present and future. One call in, one Huawei request out: no batching,
 * no retries, no loops.
 */
export async function executeDiagnosticTest(
  connection: FusionSolarConnection,
  definition: DiagnosticTestDefinition,
  target: DiagnosticIdentifier,
): Promise<DiagnosticTestResult> {
  const requestBody = definition.buildRequestBody(target.identifier);
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();

  try {
    const result = await callFusionSolarApi<unknown>(connection, {
      path: definition.path,
      body: requestBody,
    });

    return {
      testId: definition.id,
      testLabel: definition.label,
      identifier: target.identifier,
      identifierLabel: target.label,
      deviceType: target.deviceType,
      requestPath: definition.path,
      requestBody,
      timestamp,
      durationMs: Date.now() - startedAt,
      httpStatus: 200,
      success: true,
      failCode: null,
      message: null,
      responseBody: result.data,
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
        identifier: target.identifier,
        identifierLabel: target.label,
        deviceType: target.deviceType,
        requestPath: definition.path,
        requestBody,
        timestamp,
        durationMs,
        httpStatus: error.httpStatus,
        success: parsed?.success ?? false,
        failCode: parsed?.failCode ?? error.failCode,
        message: parsed?.message ?? error.message,
        responseBody: error.response,
      };
    }

    return {
      testId: definition.id,
      testLabel: definition.label,
      identifier: target.identifier,
      identifierLabel: target.label,
      deviceType: target.deviceType,
      requestPath: definition.path,
      requestBody,
      timestamp,
      durationMs,
      httpStatus: null,
      success: null,
      failCode: null,
      message: error instanceof Error ? error.message : String(error),
      responseBody: null,
    };
  }
}
