import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function TraderPendingPage() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      accountType: true,
    },
  });

  if (user?.accountType !== "ENERGY_TRADER") {
    redirect("/onboarding");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050816] px-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <h1 className="text-2xl font-semibold">You&apos;re all set</h1>

        <p className="mt-4 text-sm text-white/60">
          Your Energy Trader account has been created. An administrator will
          assign you to organizations shortly — you&apos;ll get access to
          their plant data as soon as that happens.
        </p>
      </div>
    </main>
  );
}
