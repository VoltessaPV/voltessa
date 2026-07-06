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

  return (
    <main className="p-10 text-white">
      <h1 className="text-3xl font-bold">
        Dashboard
      </h1>

      <p className="mt-4">
        Welcome {user.name}
      </p>

      <p className="mt-2">
        Organization: {user.organization?.name}
      </p>
    </main>
  );
}