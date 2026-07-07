import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
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
      organization: {
        select: {
          onboardingCompletedAt: true,
        },
      },
    },
  });

  if (!user?.organization?.onboardingCompletedAt) {
    redirect("/onboarding");
  }

  return (
    <main className="min-h-screen bg-[#050816] text-white">
      {children}
    </main>
  );
}