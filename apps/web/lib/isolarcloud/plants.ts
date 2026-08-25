import { callSungrowApi, type SungrowConnection } from "@/lib/isolarcloud/api-client";

/**
 * Station ("power station") discovery — Sungrow's equivalent of
 * `lib/fusionsolar/plants.ts`'s `getAllFusionSolarPlants`. Endpoint/field
 * names are third-party-derived (`pysolarcloud`), not confirmed against
 * Sungrow's own documentation — see `api-client.ts`'s top doc comment.
 */

export type SungrowPlant = {
  psId: string;
  psName: string;
  psLocation: string | null;
  longitude: number | string | null;
  latitude: number | string | null;
  capacityKw: number | null;
};

type SungrowStationListItem = {
  ps_id: number | string;
  ps_name: string;
  ps_location?: string | null;
  ps_longitude?: number | string | null;
  ps_latitude?: number | string | null;
  design_capacity?: number | string | null;
};

type SungrowStationListData = {
  pageList: SungrowStationListItem[];
  pageCount?: number;
  pageNo?: number;
  pageSize?: number;
  rowCount?: number;
};

const FIRST_PAGE = 1;
const PAGE_SIZE = 100;

function toStation(item: SungrowStationListItem): SungrowPlant {
  return {
    psId: String(item.ps_id),
    psName: item.ps_name,
    psLocation: item.ps_location ?? null,
    longitude: item.ps_longitude ?? null,
    latitude: item.ps_latitude ?? null,
    capacityKw:
      typeof item.design_capacity === "number"
        ? item.design_capacity
        : typeof item.design_capacity === "string" && item.design_capacity !== ""
          ? Number(item.design_capacity)
          : null,
  };
}

export async function getAllSungrowPlants(
  connection: SungrowConnection,
): Promise<SungrowPlant[]> {
  const plants: SungrowPlant[] = [];

  let page = FIRST_PAGE;
  let pageCount = FIRST_PAGE;

  do {
    const data = await callSungrowApi<SungrowStationListData>(
      connection,
      "/openapi/platform/queryPowerStationList",
      { page, size: PAGE_SIZE },
    );

    plants.push(...(data.pageList ?? []).map(toStation));

    pageCount = data.pageCount ?? FIRST_PAGE;
    page += 1;
  } while (page <= pageCount);

  return plants;
}
