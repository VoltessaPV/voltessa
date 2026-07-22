import {
  callFusionSolarApi,
  FusionSolarApiError,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";
import { filterTargetsByTypes } from "@/lib/fusionsolar/diagnostic-target-match";
import { prisma } from "@/lib/prisma";

/**
 * Generic Huawei API diagnostic framework backing the Automations page's
 * "Huawei Diagnostic Tests" section. The framework knows nothing about any
 * specific Huawei endpoint (Active Power Control or otherwise) — it only
 * knows how to: discover targets (the org's Plant + Devices), filter which
 * targets a given test supports, run a registered `DiagnosticDefinition`
 * against a chosen target (plus any declared parameters), and report the
 * result. Every concrete Huawei endpoint this can call is just one entry in
 * `DIAGNOSTIC_DEFINITIONS` — adding another endpoint later means adding one
 * entry here and, if it needs a genuinely new request shape, one small
 * `buildRequestBody` closure. No UI/component change, no framework change.
 *
 * Engineering diagnostics only, same class as `app/api/diag/fusionsolar-*`
 * — not a production feature. Two definitions below (`kind: "control"`)
 * dispatch a real Huawei command (Active Power Control) instead of only
 * reading — registered because they were explicitly requested as part of
 * this toolbox, but every `kind: "control"` definition must be clearly
 * marked as such so the UI can warn before executing it.
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

export type DiagnosticParameterType = "string" | "number";

/**
 * Describes one extra input a test needs beyond the selected target
 * (`taskId`, `collectTime`, `pageNo`, ...). The UI renders exactly one
 * generic input per declared parameter — never a test-specific component.
 * Values always travel as strings (plain HTML input values); each
 * definition's own `buildRequestBody` converts to the type Huawei expects.
 */
export type DiagnosticParameterDefinition = {
  name: string;
  label: string;
  type: DiagnosticParameterType;
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
};

export type DiagnosticParameterValues = Record<string, string>;

export type DiagnosticTestKind = "read" | "control";

/**
 * A single diagnostic test. `buildRequestBody` and the optional
 * `parseResponse` are the only endpoint-specific pieces — everything else
 * (target discovery, target-type filtering, timing, error capture, result
 * shape) lives in this module's shared functions and is identical for
 * every definition.
 */
export type DiagnosticDefinition = {
  id: string;
  label: string;
  /** "control" dispatches a real Huawei command; "read" only queries. */
  kind: DiagnosticTestKind;
  endpoint: string;
  /**
   * Which target types this test can run against — see
   * `diagnostic-target-match.ts` for exactly how each entry is matched.
   * Drives the Target dropdown's filtering; never a hardcoded UI switch.
   */
  supportedTargetTypes: string[];
  parameters: DiagnosticParameterDefinition[];
  buildRequestBody: (
    target: DiagnosticTarget,
    params: DiagnosticParameterValues,
  ) => Record<string, unknown>;
  /** Optional: normalizes the raw success payload for easier reading. The raw payload is always kept and shown regardless. */
  parseResponse?: (raw: unknown) => unknown;
};

/** Client-safe projection of a definition — metadata only, no functions. Safe to pass as props into the "use client" card. */
export type DiagnosticDefinitionMeta = {
  id: string;
  label: string;
  kind: DiagnosticTestKind;
  supportedTargetTypes: string[];
  parameters: DiagnosticParameterDefinition[];
};

export function toDiagnosticDefinitionMeta(
  definition: DiagnosticDefinition,
): DiagnosticDefinitionMeta {
  return {
    id: definition.id,
    label: definition.label,
    kind: definition.kind,
    supportedTargetTypes: definition.supportedTargetTypes,
    parameters: definition.parameters,
  };
}

// Huawei SmartPVMS Northbound API paths/body shapes below reuse exactly
// what's already confirmed elsewhere in this codebase — never invented:
// getDevRealKpi (device-real-time-kpi.ts), getDevFiveMinutes
// (device-history-kpi.ts, "old" contract), getStationRealKpi
// (plant-data.ts), getDevList (sync-devices.ts), stations (plants.ts),
// the v1 configuration endpoint (get-active-power-control-mode.ts), and
// the v2 control endpoints (export-control.ts).
export const DIAGNOSTIC_DEFINITIONS: DiagnosticDefinition[] = [
  {
    id: "active-power-control-mode",
    label: "Query Active Power Control Mode",
    kind: "read",
    endpoint:
      "/rest/openapi/pvms/nbi/v1/configuration/active-power-control-mode",
    supportedTargetTypes: ["plant", "smart-dongle", "inverter", "meter"],
    parameters: [],
    buildRequestBody: (target) => ({
      plantCode: target.devDn ?? target.plantCode,
    }),
  },
  {
    id: "active-power-control-task-status",
    label: "Query Active Power Control Task Status",
    kind: "read",
    endpoint: "/rest/openapi/pvms/nbi/v2/control/active-power-control/task-info",
    supportedTargetTypes: ["plant"],
    parameters: [
      {
        name: "taskId",
        label: "Task ID",
        type: "string",
        required: true,
        placeholder: "taskId returned by a previous dispatch",
      },
    ],
    buildRequestBody: (_target, params) => ({
      taskId: params.taskId ?? "",
    }),
  },
  {
    id: "device-real-kpi",
    label: "Get Device Real KPI",
    kind: "read",
    endpoint: "/thirdData/getDevRealKpi",
    supportedTargetTypes: ["device"],
    parameters: [],
    buildRequestBody: (target) => ({
      devIds: target.huaweiDeviceId ?? "",
      devTypeId: String(target.devTypeId ?? ""),
    }),
  },
  {
    id: "device-five-minutes",
    label: "Get Device Five Minutes",
    kind: "read",
    endpoint: "/thirdData/getDevFiveMinutes",
    supportedTargetTypes: ["device"],
    parameters: [
      {
        name: "collectTime",
        label: "Collect time (epoch ms)",
        type: "string",
        required: true,
        placeholder: "e.g. 1753171200000",
      },
    ],
    buildRequestBody: (target, params) => ({
      devIds: target.huaweiDeviceId ?? "",
      devTypeId: String(target.devTypeId ?? ""),
      collectTime: params.collectTime ?? "",
    }),
  },
  {
    id: "station-real-kpi",
    label: "Get Station Real KPI",
    kind: "read",
    endpoint: "/thirdData/getStationRealKpi",
    supportedTargetTypes: ["plant"],
    parameters: [],
    buildRequestBody: (target) => ({
      stationCodes: target.plantCode,
    }),
  },
  {
    id: "device-list",
    label: "Get Device List",
    kind: "read",
    endpoint: "/thirdData/getDevList",
    supportedTargetTypes: ["plant"],
    parameters: [],
    buildRequestBody: (target) => ({
      stationCodes: target.plantCode,
    }),
  },
  {
    id: "station-list",
    label: "Get Station List",
    kind: "read",
    endpoint: "/thirdData/stations",
    supportedTargetTypes: ["plant"],
    parameters: [
      {
        name: "pageNo",
        label: "Page number",
        type: "number",
        required: false,
        defaultValue: "1",
      },
    ],
    buildRequestBody: (_target, params) => ({
      pageNo: Number(params.pageNo || "1"),
    }),
  },
  {
    id: "deliver-apc-task-no-limit",
    label: "Deliver Active Power Control Task (No Limit)",
    kind: "control",
    endpoint: "/rest/openapi/pvms/nbi/v2/control/active-power-control/async-task",
    supportedTargetTypes: ["plant"],
    parameters: [],
    buildRequestBody: (target) => ({
      tasks: [{ plantCode: target.plantCode, controlMode: "0" }],
    }),
  },
  {
    id: "deliver-apc-task-zero-export",
    label: "Deliver Active Power Control Task (Zero Export)",
    kind: "control",
    endpoint: "/rest/openapi/pvms/nbi/v2/control/active-power-control/async-task",
    supportedTargetTypes: ["plant"],
    parameters: [],
    buildRequestBody: (target) => ({
      tasks: [
        {
          plantCode: target.plantCode,
          controlMode: "6",
          controlInfo: { maxGridFeedInPower: 0, limitationMode: 0 },
        },
      ],
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

/**
 * Re-verifies (server-side, never trusting the client) that `target` is
 * actually one of the types `definition` declares support for. Reuses the
 * exact same matcher the client uses to filter the Target dropdown, so the
 * two can never silently disagree.
 */
export function isTargetSupportedByDefinition(
  definition: DiagnosticDefinition,
  target: DiagnosticTarget,
): boolean {
  return filterTargetsByTypes([target], definition.supportedTargetTypes).length > 0;
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
  params: DiagnosticParameterValues,
): Promise<DiagnosticTestResult> {
  const requestBody = definition.buildRequestBody(target, params);
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
