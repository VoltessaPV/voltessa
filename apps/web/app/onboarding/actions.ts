"use server";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getBulgarianDistributionOperators } from "@/lib/market/distribution/bg";
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

export async function chooseEnergyTraderPersona() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    redirect("/login");
  }

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      accountType: "ENERGY_TRADER",
    },
  });

  redirect("/onboarding/trader-profile");
}

function requiredField(formData: FormData, field: string): string | null {
  const value = formData.get(field)?.toString().trim();
  return value || null;
}

/**
 * Trader Self-Service Onboarding milestone. The one place
 * `TraderProfile.onboardingCompletedAt` is ever set - Platform Admin's own
 * `updateTraderProfile` (app/(platform)/admin/actions.ts) never touches it,
 * since editing a trader's profile as an admin isn't the trader completing
 * their own onboarding. All five fields are required here (unlike the
 * admin edit form, where every field stays optional) - this is the one
 * point that decides "has this trader actually finished onboarding".
 */
export async function completeTraderOnboarding(formData: FormData) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, accountType: true },
  });

  if (!user) {
    redirect("/login");
  }

  if (user.accountType !== "ENERGY_TRADER") {
    redirect("/onboarding");
  }

  const companyName = requiredField(formData, "companyName");
  const distributionCompanyId = requiredField(formData, "distributionCompanyId");
  const firstName = requiredField(formData, "firstName");
  const lastName = requiredField(formData, "lastName");
  const phone = requiredField(formData, "phone");

  if (!companyName || !distributionCompanyId || !firstName || !lastName || !phone) {
    redirect("/onboarding/trader-profile?error=missing_fields");
  }

  if (!getBulgarianDistributionOperators().some((operator) => operator.id === distributionCompanyId)) {
    redirect("/onboarding/trader-profile?error=invalid_distribution_company");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { firstName, lastName, phone },
    }),
    prisma.traderProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        companyName,
        distributionCompanyId,
        onboardingCompletedAt: new Date(),
      },
      update: {
        companyName,
        distributionCompanyId,
        onboardingCompletedAt: new Date(),
      },
    }),
  ]);

  redirect("/dashboard");
}