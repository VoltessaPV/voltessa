import Link from "next/link";

import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { AppShell } from "@/components/platform/layout/AppShell";

export default async function PlantsPage() {
  const user = await requirePermission(Permissions.canViewPlants);

  const plants = await prisma.plant.findMany({
    where: {
      organizationId: user.organizationId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      eyebrow="Power Plants"
      title="Plants"
    >
      <div>
        <div className="mb-8 flex items-center justify-between">
          <p className="text-white/60">
            Manage photovoltaic plants connected to your organization.
          </p>

          <Link
            href="/plants/new"
            className="rounded-xl bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500"
          >
            Add Plant
          </Link>
        </div>

        {plants.length === 0 ? (
          <p>No plants yet.</p>
        ) : (
          <ul>
            {plants.map((plant) => (
              <li key={plant.id}>
                <Link
                  href={`/plants/${plant.id}`}
                  className="font-medium text-blue-400 hover:text-blue-300"
                >
                  {plant.name}
                </Link>

                <span>
                  {" "}
                  — {plant.vendor} — {plant.timezone}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
