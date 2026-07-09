import {
  callFusionSolarApi,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";

export type FusionSolarPlantRealTimeDataItemMap = {
  total_income: number | null;
  total_power: number | null;
  day_on_grid_energy: number | null;
  day_power: number | null;
  day_use_energy: number | null;
  day_income: number | null;
  real_health_state: number | null;
  month_power: number | null;
};

export type FusionSolarPlantRealTimeData = {
  stationCode: string;
  dataItemMap: FusionSolarPlantRealTimeDataItemMap;
};

export async function getFusionSolarPlantRealTimeData(
  connection: FusionSolarConnection,
  stationCodes: string[],
): Promise<FusionSolarPlantRealTimeData[]> {
  if (stationCodes.length === 0) {
    return [];
  }

  const result = await callFusionSolarApi<
    FusionSolarPlantRealTimeData[]
  >(connection, {
    path: "/thirdData/getStationRealKpi",
    body: {
      stationCodes: stationCodes.join(","),
    },
  });

  return result.data;
}
