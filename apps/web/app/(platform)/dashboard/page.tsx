import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    include: {
      organization: true,
    },
  });

  if (!user?.organizationId) {
    redirect("/onboarding");
  }

  const plants = await prisma.plant.findMany({
    where: {
      organizationId: user.organizationId,
    },
    include: {
      telemetrySnapshots: {
        orderBy: {
          collectedAt: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  return (
    <main className="p-10 text-white">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <p className="mt-4">Welcome {user.name}</p>

      <p className="mt-2">Organization: {user.organization?.name}</p>

      <div className="mt-8 space-y-4">
        {plants.map((plant) => {
          const telemetry = plant.telemetrySnapshots[0];

          return (
            <div
              key={plant.id}
              className="rounded-lg border border-neutral-700 p-6"
            >
              <h2 className="text-xl font-semibold">{plant.name}</h2>

              <p className="mt-3">
                Lifetime Energy: {telemetry?.totalPower?.toString() ?? "-"} kWh
              </p>

              <p>Today: {telemetry?.dayPower?.toString() ?? "-"} kWh</p>

              <p>This Month: {telemetry?.monthPower?.toString() ?? "-"} kWh</p>

              <p>
                Exported Today: {telemetry?.dayOnGridEnergy?.toString() ?? "-"}{" "}
                kWh
              </p>

              <p>
                Consumed Today: {telemetry?.dayUseEnergy?.toString() ?? "-"} kWh
              </p>

              <p>
                Last Update:{" "}
                {telemetry ? telemetry.collectedAt.toLocaleString() : "-"}
              </p>
            </div>
          );
        })}
      </div>
    </main>
  );
}
