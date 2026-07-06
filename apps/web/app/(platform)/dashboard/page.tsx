import { auth } from "@/auth";
import { redirect } from "next/navigation";

import AppHeader from "@/components/platform/layout/AppHeader";
import AppShell from "@/components/platform/layout/AppShell";
import AppSidebar from "@/components/platform/layout/AppSidebar";

import { signOut } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell
      sidebar={<AppSidebar />}
      header={<AppHeader />}
    >
      <div className="rounded-2xl border border-slate-800 bg-[#0B1020] p-8">
  <h2 className="text-xl font-semibold">
    Welcome to Voltessa
  </h2>

  <p className="mt-3 max-w-2xl text-slate-400">
    This dashboard will display real-time information about your
    solar plants, battery systems, electricity markets and AI
    recommendations.
  </p>
</div>
    </AppShell>
    
  );
}