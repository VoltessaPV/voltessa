"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export async function createPlant(formData: FormData) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      organizationId: true,
    },
  });

  if (!user?.organizationId) {
    redirect("/onboarding");
  }

  const name = formData.get("name")?.toString().trim();
  const vendor = formData.get("vendor")?.toString().trim();
  const timezone = formData.get("timezone")?.toString().trim();

  if (!name) {
    return;
  }

  const plant = await prisma.plant.create({
    data: {
      name,
      vendor: vendor || "Huawei",
      timezone: timezone || "Europe/Sofia",
      organizationId: user.organizationId,
    },
  });

  redirect(`/plants/${plant.id}`);
}