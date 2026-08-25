import { callSungrowApi, type SungrowConnection } from "@/lib/isolarcloud/api-client";

/**
 * Sungrow Grid Control — active-power / feed-in limitation. Mirrors the
 * read/write split already established by
 * `lib/fusionsolar/get-active-power-control-mode.ts` (read) and
 * `lib/fusionsolar/export-control.ts` (write), but with one deliberate
 * difference driven by what could actually be verified: Huawei's write
 * path is at least backed by a confirmed official Northbound API Reference
 * page (see that module's own doc comment). Nothing here has been
 * confirmed against Sungrow's official documentation — the portal's real
 * "API Document" is login-gated and could not be reached. Everything below
 * is derived from the third-party `pysolarcloud` client's `control.py`,
 * whose own source comments claim the parameter codes are "defined in API
 * documentation" (i.e. reproduced from a real portal session, not
 * invented) — the closest available approximation, not a confirmed source.
 *
 * The application's portal-confirmed capabilities include "Grid Control"
 * (per the user's own account), which resolves the *account-level
 * approval* question — but it does NOT resolve two separate, per-device
 * questions this module cannot answer from documentation alone:
 *
 *   1. Which device TYPE (inverter vs. grid-connection-point vs. energy
 *      storage system) the feed-in-limitation parameter codes below should
 *      target for a plain grid-tied PV plant with no battery. The only
 *      worked example available applies `Control` to an
 *      `ENERGY_STORAGE_SYSTEM` device for battery parameters, not to
 *      feed-in limitation.
 *   2. Whether the specific inverter model(s) Voltessa will connect (e.g.
 *      SG-50KT / SG50KT) support this parameter at all.
 *
 * `SUNGROW_EXPORT_LIMIT_VERIFIED_DEVICE_TYPES` is the single gate that
 * keeps this module honest about that: it starts EMPTY. Every write
 * function below refuses to dispatch — throwing a clear, typed error,
 * never a silent no-op and never a fabricated success — for any device
 * type not explicitly added to that list once verified (against the real
 * Sungrow API Document, or a confirmed successful test against a real
 * device). Do not add an entry to it without that verification.
 */

/** Empty on purpose — see this module's top doc comment. */
export const SUNGROW_EXPORT_LIMIT_VERIFIED_DEVICE_TYPES: ReadonlySet<number> = new Set();

export class SungrowGridControlUnverifiedError extends Error {
  constructor(deviceType: number) {
    super(
      `Sungrow export-limitation control is not verified for device type ${deviceType} — refusing to dispatch. See lib/isolarcloud/grid-control.ts for what needs confirming before this can be enabled.`,
    );
    this.name = "SungrowGridControlUnverifiedError";
  }
}

/** Parameter codes as reproduced in `pysolarcloud`'s `control.py` — not independently confirmed. */
const PARAM_CODE = {
  LIMITED_POWER_SWITCH: "10007",
  ACTIVE_POWER_LIMIT_RATIO: "10008",
  FEED_IN_LIMITATION: "10012",
  FEED_IN_LIMITATION_VALUE: "10013",
} as const;

const READ_SET_TYPE = 2;
const WRITE_SET_TYPE = 0;
const DEFAULT_EXPIRE_SECONDS = 120;

export type SungrowParamSettingTaskStatus = "RUNNING" | "SUCCESS" | "FAIL" | "UNKNOWN";

type SungrowParamSettingCheckData = {
  check_result?: Array<{ uuid: string; check_result: string }>;
};

type SungrowParamSettingResponseData = {
  task_id?: string;
};

type SungrowParamSettingTaskData = {
  command_status?: number;
  result_list?: Array<{ param_code: string; value?: string | null }>;
};

/**
 * Read-only capability probe (`set_type: 2` per `pysolarcloud`) — safe to
 * call regardless of the verified-device-type gate below, since it never
 * writes anything.
 */
export async function checkSungrowExportLimitCapability(
  connection: SungrowConnection,
  deviceUuid: string,
): Promise<boolean> {
  const data = await callSungrowApi<SungrowParamSettingCheckData>(
    connection,
    "/openapi/platform/paramSettingCheck",
    { set_type: READ_SET_TYPE, uuid: deviceUuid },
  );

  return (
    data.check_result?.find((entry) => entry.uuid === deviceUuid)?.check_result === "1"
  );
}

/**
 * Reads the device's current feed-in-limitation configuration. Read-only —
 * not gated by the verified-device-type allowlist, since a read cannot
 * change plant behavior even if the parameter turns out to target the
 * wrong device type for this model.
 */
export async function readSungrowExportLimit(
  connection: SungrowConnection,
  deviceUuid: string,
): Promise<{ taskId: string }> {
  const data = await callSungrowApi<SungrowParamSettingResponseData>(
    connection,
    "/openapi/platform/paramSetting",
    {
      set_type: READ_SET_TYPE,
      uuid: deviceUuid,
      task_name: `voltessa-read-export-limit-${Date.now()}`,
      expire_second: DEFAULT_EXPIRE_SECONDS,
      param_list: [
        { param_code: PARAM_CODE.FEED_IN_LIMITATION, set_value: "" },
        { param_code: PARAM_CODE.FEED_IN_LIMITATION_VALUE, set_value: "" },
      ],
    },
  );

  if (!data.task_id) {
    throw new Error("Sungrow paramSetting (read) did not return a task_id");
  }

  return { taskId: data.task_id };
}

function assertDeviceTypeVerified(deviceType: number): void {
  if (!SUNGROW_EXPORT_LIMIT_VERIFIED_DEVICE_TYPES.has(deviceType)) {
    throw new SungrowGridControlUnverifiedError(deviceType);
  }
}

/**
 * Dispatches a feed-in-limitation write. Deliberately gated by
 * `assertDeviceTypeVerified` — throws rather than dispatching for any
 * device type not yet verified (currently: none). This is the write-side
 * equivalent of Huawei's `setExportLimit`/`restoreExport`
 * (`lib/fusionsolar/export-control.ts`), which is itself already
 * "not called from anywhere yet" pending its own confirmation work — this
 * module follows the same precedent of writing the code without wiring a
 * live, unverified path.
 */
export async function setSungrowExportLimit(
  connection: SungrowConnection,
  device: { uuid: string; deviceType: number },
  maxFeedInPowerKw: number,
): Promise<{ taskId: string }> {
  assertDeviceTypeVerified(device.deviceType);

  const data = await callSungrowApi<SungrowParamSettingResponseData>(
    connection,
    "/openapi/platform/paramSetting",
    {
      set_type: WRITE_SET_TYPE,
      uuid: device.uuid,
      task_name: `voltessa-set-export-limit-${Date.now()}`,
      expire_second: DEFAULT_EXPIRE_SECONDS,
      param_list: [
        { param_code: PARAM_CODE.LIMITED_POWER_SWITCH, set_value: "1" },
        { param_code: PARAM_CODE.FEED_IN_LIMITATION, set_value: "1" },
        { param_code: PARAM_CODE.FEED_IN_LIMITATION_VALUE, set_value: String(maxFeedInPowerKw) },
      ],
    },
  );

  if (!data.task_id) {
    throw new Error("Sungrow paramSetting (write) did not return a task_id");
  }

  return { taskId: data.task_id };
}

/** Restores unlimited export. Same verified-device-type gate as `setSungrowExportLimit`. */
export async function restoreSungrowExport(
  connection: SungrowConnection,
  device: { uuid: string; deviceType: number },
): Promise<{ taskId: string }> {
  assertDeviceTypeVerified(device.deviceType);

  const data = await callSungrowApi<SungrowParamSettingResponseData>(
    connection,
    "/openapi/platform/paramSetting",
    {
      set_type: WRITE_SET_TYPE,
      uuid: device.uuid,
      task_name: `voltessa-restore-export-${Date.now()}`,
      expire_second: DEFAULT_EXPIRE_SECONDS,
      param_list: [
        { param_code: PARAM_CODE.LIMITED_POWER_SWITCH, set_value: "0" },
        { param_code: PARAM_CODE.FEED_IN_LIMITATION, set_value: "0" },
      ],
    },
  );

  if (!data.task_id) {
    throw new Error("Sungrow paramSetting (restore) did not return a task_id");
  }

  return { taskId: data.task_id };
}

const COMMAND_STATUS_DONE = 8;
const COMMAND_STATUS_RUNNING = 2;

/** Polls a previously-dispatched param-setting task (read or write) until it settles. */
export async function getSungrowParamSettingTaskStatus(
  connection: SungrowConnection,
  deviceUuid: string,
  taskId: string,
): Promise<{ status: SungrowParamSettingTaskStatus; values: Record<string, string | null> }> {
  const data = await callSungrowApi<SungrowParamSettingTaskData>(
    connection,
    "/openapi/platform/getParamSettingTask",
    { task_id: taskId, uuid: deviceUuid },
  );

  const values = Object.fromEntries(
    (data.result_list ?? []).map((entry) => [entry.param_code, entry.value ?? null]),
  );

  const status: SungrowParamSettingTaskStatus =
    data.command_status === COMMAND_STATUS_DONE
      ? "SUCCESS"
      : data.command_status === COMMAND_STATUS_RUNNING
        ? "RUNNING"
        : data.command_status === undefined
          ? "UNKNOWN"
          : "FAIL";

  return { status, values };
}
