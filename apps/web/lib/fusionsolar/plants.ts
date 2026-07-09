import {
  callFusionSolarApi,
  type FusionSolarConnection,
} from "@/lib/fusionsolar/api-client";

export type FusionSolarPlant = {
  plantCode: string;
  plantName: string;
  plantAddress: string | null;
  longitude: number | string | null;
  latitude: number | string | null;
  capacity: number;
  contactPerson: string | null;
  contactMethod: string | null;
  gridConnectionDate: string | null;
};

type FusionSolarPlantListData = {
  list: FusionSolarPlant[];
  pageCount: number;
  pageNo: number;
  pageSize: number;
  total: number;
};

const FIRST_PAGE = 1;

export async function getAllFusionSolarPlants(
  connection: FusionSolarConnection,
): Promise<FusionSolarPlant[]> {
  const plants: FusionSolarPlant[] = [];

  let pageNo = FIRST_PAGE;
  let pageCount = FIRST_PAGE;

  do {
    const result =
      await callFusionSolarApi<FusionSolarPlantListData>(
        connection,
        {
          path: "/thirdData/stations",
          body: {
            pageNo,
          },
        },
      );

    plants.push(...result.data.list);

    pageCount = result.data.pageCount;
    pageNo += 1;
  } while (pageNo <= pageCount);

  return plants;
}
