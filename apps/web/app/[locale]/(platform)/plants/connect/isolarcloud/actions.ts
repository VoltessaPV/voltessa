"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { findSungrowConnection } from "@/lib/isolarcloud/api-client";
import { getAllSungrowPlants } from "@/lib/isolarcloud/plants";
import { syncSungrowDevicesForPlant } from "@/lib/isolarcloud/sync-devices";
import { prisma } from "@/lib/prisma";

/**
 * The one genuinely new "Connect Plant" step this milestone introduces —
 * see `app/api/auth/isolarcloud/callback/route.ts`'s doc comment for why
 * Sungrow needs a picker where Huawei doesn't. Follows
 * `app/[locale]/(platform)/plants/actions.ts`'s existing conventions
 * (`"use server"`, `requirePermission(Permissions.canManagePlants)`,
 * `redirect` from `next/navigation`) rather than inventing a new one.
 */
export async function connectSungrowPlant(formData: FormData) {
  const user = await requirePermission(Permissions.canManagePlants);

  const psId = formData.get("psId")?.toString().trim();
  const psName = formData.get("psName")?.toString().trim();

  if (!psId || !psName) {
    return;
  }

  const connection = await findSungrowConnection(user.organizationId);

  if (!connection) {
    redirect("/plants/connect");
  }

  // Re-fetch the live station list rather than trusting the submitted
  // `psName`/capacity alone — the form only round-trips `psId`/`psName` as
  // the minimum needed to identify the choice; everything else comes fresh
  // from Sungrow at connection time, same discipline
  // `lib/isolarcloud/sync-devices.ts` already applies to device fields.
  const stations = await getAllSungrowPlants(connection);
  const station = stations.find((candidate) => candidate.psId === psId);

  if (!station) {
    redirect("/plants/connect/isolarcloud?isolarcloud=station_not_found");
  }

  const toDecimal = (value: number | string | null): Prisma.Decimal | null => {
    if (value === null || value === "") {
      return null;
    }
    try {
      return new Prisma.Decimal(value);
    } catch {
      return null;
    }
  };

  const plantData = {
    name: station.psName,
    capacityKw: toDecimal(station.capacityKw),
    latitude: toDecimal(station.latitude),
    longitude: toDecimal(station.longitude),
    address: station.psLocation,
  };

  const plant = await prisma.plant.upsert({
    where: { organizationId_stationCode: { organizationId: user.organizationId, stationCode: psId } },
    create: {
      organizationId: user.organizationId,
      vendor: "Sungrow",
      stationCode: psId,
      plantCode: psId,
      ...plantData,
    },
    update: plantData,
  });

  await syncSungrowDevicesForPlant(connection, plant.id, psId);

  redirect(`/plants/${plant.id}`);
}
