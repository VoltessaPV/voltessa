import Link from "next/link";
import { notFound } from "next/navigation";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function PlantDetailsPage({ params }: Props) {
  const user = await requirePermission(Permissions.canViewPlants);

  const { id } = await params;

  const plant = await prisma.plant.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
    },
  });

  if (!plant) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">{plant.name}</h2>

        <Link
          href={`/plants/${plant.id}/edit`}
          className="rounded-xl bg-blue-600 px-4 py-2 hover:bg-blue-500"
        >
          Edit
        </Link>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <dl className="grid grid-cols-3 gap-8">
          <div>
            <dt className="text-sm text-white/50">Vendor</dt>

            <dd className="mt-1">{plant.vendor}</dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">Timezone</dt>

            <dd className="mt-1">{plant.timezone}</dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">Created</dt>

            <dd className="mt-1">{plant.createdAt.toLocaleString()}</dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">Station Code</dt>

            <dd className="mt-1">{plant.stationCode ?? "-"}</dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">Capacity</dt>

            <dd className="mt-1">
              {plant.capacityKw ? `${plant.capacityKw} kW` : "-"}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">Country</dt>

            <dd className="mt-1">{plant.country ?? "-"}</dd>
          </div>

          <div>
            <dt className="text-sm text-white/50">City</dt>

            <dd className="mt-1">{plant.city ?? "-"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
