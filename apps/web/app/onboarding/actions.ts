"use server";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function createOrganization(formData: FormData) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const name = formData.get("name")?.toString().trim();

  if (!name) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      id: true,
      organizationId: true,
    },
  });

  if (!user) {
    redirect("/login");
  }

  if (user.organizationId) {
    await prisma.organization.update({
      where: {
        id: user.organizationId,
      },
      data: {
        name,
        onboardingCompletedAt: new Date(),
      },
    });
  } else {
    const organization = await prisma.organization.create({
      data: {
        name,
        onboardingCompletedAt: new Date(),
      },
      select: {
        id: true,
      },
    });

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        organizationId: organization.id,
        role: "OWNER",
      },
    });
  }

  redirect("/dashboard");
}