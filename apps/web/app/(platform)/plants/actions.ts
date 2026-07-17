"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

function optionalString(formData: FormData, field: string) {
  const value = formData.get(field)?.toString().trim();

  return value || null;
}

function optionalDecimal(formData: FormData, field: string) {
  const value = formData.get(field)?.toString().trim();

  if (!value) {
    return null;
  }

  return new Prisma.Decimal(value);
}

export async function createPlant(formData: FormData) {
  const user = await requirePermission(Permissions.canManagePlants);

  const name = formData.get("name")?.toString().trim();

  if (!name) {
    return;
  }

  const plant = await prisma.plant.create({
    data: {
      name,
      vendor: optionalString(formData, "vendor") ?? "Huawei",
      timezone: optionalString(formData, "timezone") ?? "Europe/Sofia",

      stationCode: optionalString(formData, "stationCode"),
      plantCode: optionalString(formData, "plantCode"),

      capacityKw: optionalDecimal(formData, "capacityKw"),

      latitude: optionalDecimal(formData, "latitude"),
      longitude: optionalDecimal(formData, "longitude"),

      country: optionalString(formData, "country"),
      city: optionalString(formData, "city"),
      address: optionalString(formData, "address"),

      organizationId: user.organizationId,
    },
  });

  redirect(`/plants/${plant.id}`);
}

export async function updatePlant(plantId: string, formData: FormData) {
  const user = await requirePermission(Permissions.canManagePlants);

  const existingPlant = await prisma.plant.findFirst({
    where: {
      id: plantId,
      organizationId: user.organizationId,
    },
    select: {
      id: true,
    },
  });

  if (!existingPlant) {
    redirect("/plants");
  }

  const name = formData.get("name")?.toString().trim();

  if (!name) {
    return;
  }

  await prisma.plant.update({
    where: {
      id: existingPlant.id,
    },
    data: {
      name,
      vendor: optionalString(formData, "vendor") ?? "Huawei",
      timezone: optionalString(formData, "timezone") ?? "Europe/Sofia",

      stationCode: optionalString(formData, "stationCode"),
      plantCode: optionalString(formData, "plantCode"),

      capacityKw: optionalDecimal(formData, "capacityKw"),

      latitude: optionalDecimal(formData, "latitude"),
      longitude: optionalDecimal(formData, "longitude"),

      country: optionalString(formData, "country"),
      city: optionalString(formData, "city"),
      address: optionalString(formData, "address"),
    },
  });

  redirect(`/plants/${existingPlant.id}`);
}
