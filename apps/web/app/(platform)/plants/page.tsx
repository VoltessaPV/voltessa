import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function PlantsPage() {
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

  const plants = await prisma.plant.findMany({
    where: {
      organizationId: user.organizationId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Plants</h1>

          <p className="mt-2 text-white/60">
            Manage photovoltaic plants connected to your organization.
          </p>
        </div>

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
  );
}