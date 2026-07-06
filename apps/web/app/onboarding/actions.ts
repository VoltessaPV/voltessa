"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export async function createOrganization(formData: FormData) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const name = formData.get("name")?.toString().trim();

  if (!name) {
    return;
  }

  const organization = await prisma.organization.create({
    data: {
      name,
    },
  });

  await prisma.user.update({
    where: {
      email: session.user.email,
    },
    data: {
      organizationId: organization.id,
      role: "OWNER",
    },
  });

  redirect("/dashboard");
}