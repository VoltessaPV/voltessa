import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type SettingsPageProps = {
  searchParams: Promise<{
    fusionsolar?: string;
    reason?: string;
  }>;
};

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
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

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: user.organizationId,
        provider: "HuaweiFusionSolar",
      },
    },
  });

  const params = await searchParams;

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold">Settings</h1>

        <p className="mt-2 text-white/60">
          Manage organization integrations and platform settings.
        </p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center justify-between gap-6">
          <div>
            <h2 className="text-lg font-medium">
              Huawei FusionSolar
            </h2>

            <p className="mt-2 text-sm text-white/60">
              Connect your organization to FusionSolar.
            </p>
          </div>

          <Link
            href="/api/auth/fusionsolar/connect"
            className="rounded-xl bg-blue-600 px-4 py-2 font-medium transition hover:bg-blue-500"
          >
            {connection ? "Reconnect" : "Connect FusionSolar"}
          </Link>
        </div>

        {params.fusionsolar === "callback_ok" && (
          <p className="mt-6 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-300">
            FusionSolar OAuth callback received successfully.
          </p>
        )}

        {params.fusionsolar &&
          params.fusionsolar !== "callback_ok" && (
            <p className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              FusionSolar connection failed: {params.reason ?? params.fusionsolar}
            </p>
          )}
      </section>
    </div>
  );
}