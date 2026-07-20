import {
  callFusionSolarApi,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";

/**
 * Huawei SmartPVMS Northbound "v2 control" API — a different endpoint
 * family from the /thirdData/* read APIs used elsewhere in lib/fusionsolar.
 *
 * Sources (public Huawei Northbound API Reference, consistent across the
 * 24.x/25.x versions checked):
 * - "API for Delivering an Inverter Active Power Setting Task"
 * - "API for Querying Inverter Active Power Setting Tasks"
 *
 * Confirmed with reasonable confidence: the endpoint paths, the async-task
 * model (dispatch returns a taskId, poll task-info for the result), the
 * controlMode values ("0" = unlimited / restore, "6" = limited feed-in),
 * the controlInfo fields (maxGridFeedInPower, limitationMode), and that the
 * response envelope (success/failCode/message/data) matches this repo's
 * existing FusionSolarApiResponse<T> shape exactly.
 *
 * Request body wrapper key CONFIRMED against the live SmartPVMS 25.4.0
 * Northbound API Reference page (verbatim example fetched directly, not
 * just search-indexed summaries): the top-level array is `tasks`, not
 * `plantList`. The first real manual test call (see the Huawei Control
 * milestone) failed with `api_path_not_allowed`, which prompted this
 * verification and correction. Everything else this file assumed
 * (endpoint paths, the async-task model, controlMode values, controlInfo
 * fields, the success/failCode/message/data response envelope) matched
 * the same confirmed doc page's example exactly and is unchanged.
 *
 * Requires the FusionSolar OAuth connection to have been granted the
 * `pvms.openapi.control` scope (in addition to `pvms.openapi.basic`) by the
 * FusionSolar company administrator — System > Company Management >
 * Northbound Management in the FusionSolar portal. This is an account-level
 * grant, not something this code can request or verify itself. If it's
 * missing, expect an authorization-shaped failure, not a request-shape 4xx.
 *
 * Plant identifier: this repo's `Plant.stationCode` and `Plant.plantCode`
 * are always populated with the same value (see
 * lib/fusionsolar/sync-plants.ts), which is itself the "plantCode" field
 * Huawei's plant-list read API returns — so either column is the correct
 * value to pass as `plantCode` below.
 *
 * These functions are not called from anywhere yet. No cron, no route, no
 * UI references this file — verify manually (see PR description / commit
 * message for instructions) before wiring anything to it.
 */

const ACTIVE_POWER_CONTROL_TASK_PATH =
  "/rest/openapi/pvms/nbi/v2/control/active-power-control/async-task";

const ACTIVE_POWER_CONTROL_TASK_INFO_PATH =
  "/rest/openapi/pvms/nbi/v2/control/active-power-control/task-info";

const ACTIVE_POWER_CONTROL_MODE = {
  UNLIMITED: "0",
  LIMITED_FEED_IN: "6",
} as const;

export type ActivePowerControlDispatchStatus =
  | "RUNNING"
  | "SUCCESS"
  | "FAIL";

export type ActivePowerControlDispatchResult = {
  taskId: string;
  result: Array<{
    plantCode: string;
    status: ActivePowerControlDispatchStatus;
    message?: string | null;
  }>;
};

export type ActivePowerControlTaskInfo = {
  dispatchResult: Array<{
    plantCode: string;
    controlMode: string;
    status: ActivePowerControlDispatchStatus;
    controlInfo?: {
      maxGridFeedInPower?: number;
      limitationMode?: number;
    } | null;
    message?: string | null;
  }>;
};

async function deliverActivePowerControlTask(
  connection: FusionSolarConnection,
  plantCode: string,
  controlMode: (typeof ACTIVE_POWER_CONTROL_MODE)[keyof typeof ACTIVE_POWER_CONTROL_MODE],
  controlInfo?: {
    maxGridFeedInPower: number;
    limitationMode: number;
  },
): Promise<ActivePowerControlDispatchResult> {
  const result =
    await callFusionSolarApi<ActivePowerControlDispatchResult>(
      connection,
      {
        path: ACTIVE_POWER_CONTROL_TASK_PATH,
        body: {
          tasks: [
            {
              plantCode,
              controlMode,
              ...(controlInfo ? { controlInfo } : {}),
            },
          ],
        },
      },
    );

  return result.data;
}

/**
 * Dispatches a task limiting grid export for a single plant to
 * `maxGridFeedInPowerKw`. Returns immediately with a taskId — this does
 * NOT confirm the limit was actually applied. Call
 * `getActivePowerControlTaskStatus` with the returned taskId to check.
 */
export async function setExportLimit(
  connection: FusionSolarConnection,
  plantCode: string,
  maxGridFeedInPowerKw: number,
): Promise<ActivePowerControlDispatchResult> {
  return deliverActivePowerControlTask(
    connection,
    plantCode,
    ACTIVE_POWER_CONTROL_MODE.LIMITED_FEED_IN,
    {
      maxGridFeedInPower: maxGridFeedInPowerKw,
      limitationMode: 0,
    },
  );
}

/**
 * Dispatches a task restoring unlimited grid export for a single plant.
 * Same async-task caveat as `setExportLimit` applies.
 */
export async function restoreExport(
  connection: FusionSolarConnection,
  plantCode: string,
): Promise<ActivePowerControlDispatchResult> {
  return deliverActivePowerControlTask(
    connection,
    plantCode,
    ACTIVE_POWER_CONTROL_MODE.UNLIMITED,
  );
}

/**
 * Reads back the status/result of a previously dispatched active-power-
 * control task. This is the closest confirmed way to read a plant's export
 * limit today: Huawei's API surfaces this as "the result of a task this
 * integration dispatched," not a standalone "what is the plant's current
 * limit right now" query independent of any task. A separate read API
 * ("API for Querying an Inverter Active Power Control Mode") appears to
 * exist in Huawei's reference docs, but its exact endpoint/payload could
 * not be confirmed via available research — not implemented here rather
 * than guessed at. See the accompanying explanation for why.
 */
export async function getActivePowerControlTaskStatus(
  connection: FusionSolarConnection,
  taskId: string,
): Promise<ActivePowerControlTaskInfo> {
  const result =
    await callFusionSolarApi<ActivePowerControlTaskInfo>(
      connection,
      {
        path: ACTIVE_POWER_CONTROL_TASK_INFO_PATH,
        body: { taskId },
      },
    );

  return result.data;
}
