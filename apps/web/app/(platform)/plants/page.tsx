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
      <div>
        <h1>Plants</h1>

        <Link href="/plants/new">
          Add Plant
        </Link>
      </div>

      {plants.length === 0 ? (
        <p>No plants yet.</p>
      ) : (
        <ul>
          {plants.map((plant) => (
            <li key={plant.id}>
              <Link href={`/plants/${plant.id}`}>
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