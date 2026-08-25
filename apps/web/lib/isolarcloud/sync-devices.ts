import type { SungrowConnection } from "@/lib/isolarcloud/api-client";
import { getAllSungrowDevicesForStation } from "@/lib/isolarcloud/devices";
import { prisma } from "@/lib/prisma";

/**
 * Sungrow's equivalent of `lib/fusionsolar/sync-devices.ts`, with one
 * structural difference: Huawei's sync walks every already-known plant for
 * an organization, because Huawei's callback auto-creates a `Plant` row per
 * discovered station. Sungrow's connection flow requires the customer to
 * pick one station via `/plants/connect/isolarcloud` (see that page's
 * server action) before any `Plant` exists — so this only ever syncs
 * devices for the one plant just created/associated, not "every Sungrow
 * plant in the organization."
 */
export async function syncSungrowDevicesForPlant(
  connection: SungrowConnection,
  plantId: string,
  psId: string,
): Promise<{ devicesSynced: number }> {
  const devices = await getAllSungrowDevicesForStation(connection, psId);

  if (devices.length === 0) {
    return { devicesSynced: 0 };
  }

  await prisma.$transaction(
    devices.map((device) =>
      prisma.device.upsert({
        where: { plantId_devDn: { plantId, devDn: device.uuid } },
        create: {
          plantId,
          vendor: "Sungrow",
          devDn: device.uuid,
          devName: device.deviceName,
          devTypeId: device.deviceType,
          model: device.deviceModel,
        },
        update: {
          devName: device.deviceName,
          devTypeId: device.deviceType,
          model: device.deviceModel,
        },
      }),
    ),
  );

  return { devicesSynced: devices.length };
}
