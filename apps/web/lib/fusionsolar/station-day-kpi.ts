import {
  callFusionSolarApi,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";

/**
 * Huawei thirdData "getKpiStationDay" — historical daily station KPI query,
 * never called by this codebase before this milestone (Historical Data
 * Auto-Import). `getStationRealKpi` (already integrated, `plant-data.ts`)
 * only ever returns *today's* live cumulative counters and has no date
 * parameter; this is the historical counterpart Huawei's "Report" API
 * family exposes for arbitrary past days.
 *
 * Request/response envelope matches every other `thirdData` endpoint this
 * codebase already calls (`{stationCodes, collectTime}` in,
 * `{success, failCode, message, data}` out, `api-client.ts`'s
 * `callFusionSolarApi` already unwraps that).
 *
 * Confirmed against a real production response (Historical Data Auto-Import
 * Phase 0 diagnostic, run directly against the Atlanta plant through the
 * gateway — not from documentation, which was unavailable in this
 * environment): `collectTime` anchors a whole **calendar month** (any
 * timestamp within the target month), and `data` contains one entry per day
 * in that month — NOT one entry per call like `getDevFiveMinutes`. A single
 * call therefore backfills an entire month of daily KPIs.
 *
 * `dataItemMap` field mapping, confirmed against the existing
 * `PlantDailyKpi` row for the same day (2026-07-30, `pvYieldKwh: 1197.71`,
 * `consumptionKwh: 904.15`, `exportedEnergyKwh: 397.17`):
 * - `PVYield` (identical to `inverterYield`/`inverter_power` for this
 *   plant) -> `PlantDailyKpi.pvYieldKwh` — exact match (1197.71 = 1197.71).
 * - `ongrid_power` -> `PlantDailyKpi.exportedEnergyKwh` — exact match
 *   (397.17 = 397.17).
 * - `use_power` -> `PlantDailyKpi.consumptionKwh` — near-exact
 *   (905.04 vs. 904.15, ~0.1% diff; this Report-family endpoint appears to
 *   settle the day slightly differently than `getStationRealKpi`'s live
 *   running counter — same metric, not a different one).
 * - `buyPower` (grid import total) and `selfUsePower`/`selfProvide`
 *   (self-consumption) are also present and could one day back "From Grid"
 *   /"Consumed from PV" authoritatively, but those cards already work
 *   correctly off `DeviceTelemetry` — documented here, not wired in.
 * - `reduction_total_tree`/`reduction_total_co2`/`reduction_total_coal`
 *   (environmental-impact stats) and `installed_capacity` (returned as `0`
 *   for this plant) have no current Dashboard purpose.
 */
export type FusionSolarStationDayKpiItemMap = {
  PVYield: number | null;
  ongrid_power: number | null;
  use_power: number | null;
  buyPower: number | null;
  selfUsePower: number | null;
  selfProvide: number | null;
  inverter_power: number | null;
  inverterYield: number | null;
  installed_capacity: number | null;
  reduction_total_tree: number | null;
  reduction_total_co2: number | null;
  reduction_total_coal: number | null;
};

export type FusionSolarStationDayKpi = {
  collectTime: number;
  stationCode: string;
  dataItemMap: FusionSolarStationDayKpiItemMap;
};

export async function getFusionSolarStationDayKpi(
  connection: FusionSolarConnection,
  params: { stationCode: string; collectTime: number },
): Promise<FusionSolarStationDayKpi[]> {
  const result = await callFusionSolarApi<FusionSolarStationDayKpi[]>(connection, {
    path: "/thirdData/getKpiStationDay",
    body: {
      stationCodes: params.stationCode,
      collectTime: params.collectTime,
    },
  });

  return result.data;
}
