import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppShell } from "@/components/platform/layout/AppShell";
import { prisma } from "@/lib/prisma";

type Props = {
  children: ReactNode;
};

export default async function PlatformLayout({
  children,
}: Props) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      name: true,
      email: true,
      role: true,
      organization: {
        select: {
          name: true,
          onboardingCompletedAt: true,
        },
      },
    },
  });

  if (!user?.organization?.onboardingCompletedAt) {
    redirect("/onboarding");
  }

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
      }}
      organization={{
        name: user.organization.name,
      }}
    >
      {children}
    </AppShell>
  );
}