import { notFound } from "next/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { FusionSolarAtlantaConsole } from "./FusionSolarAtlantaConsole";

const ATLANTA_PLANT_NAME = "Atlanta";

/**
 * Temporary internal debugging tool for the Atlanta plant only - not
 * linked from any navigation. Deliberately outside app/(platform): this
 * route needs its own explicit auth/organization check (proxy.ts's
 * middleware matcher and (platform)/layout.tsx's requireOnboardedUser()
 * only cover /dashboard and the routes nested under (platform) - neither
 * applies here for free).
 *
 * Access is restricted to authenticated users whose own organization
 * owns a Plant named "Atlanta" - any other organization gets a plain
 * 404, never a hint that this page exists or what it controls.
 */
export const metadata = {
  robots: { index: false, follow: false },
};

export default async function FusionSolarAtlantaDebugPage() {
  const user = await requirePermission(Permissions.canOperatePlants);

  const plant = await prisma.plant.findFirst({
    where: { organizationId: user.organizationId, name: ATLANTA_PLANT_NAME },
    select: { id: true },
  });

  if (!plant) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[#050816] px-8 py-12 text-white">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">FusionSolar Atlanta Debug Console</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Temporary internal debugging tool for the Atlanta plant only - reuses the FusionSolar
            browser automation module. Nothing here runs automatically; every action is a manual,
            one-time click.
          </p>
        </div>

        <FusionSolarAtlantaConsole />
      </div>
    </div>
  );
}
