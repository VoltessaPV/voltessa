import Link from "next/link";

import { getAdminDashboardStats, resolveUserDisplayName } from "@/lib/admin/queries";

export { pageHeading } from "./heading";

const ACTION_LABELS: Record<string, string> = {
  user_activated: "activated",
  user_deactivated: "deactivated",
  user_profile_updated: "updated profile",
  user_email_changed: "changed email",
  trader_profile_updated: "updated trader profile",
  trader_assigned: "assigned trader",
  trader_changed: "changed trader",
  trader_removed: "removed trader",
};

function StatCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-white/20"
    >
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </Link>
  );
}

export default async function AdminDashboardPage() {
  const stats = await getAdminDashboardStats();

  return (
    <div className="space-y-8">
      <p className="text-white/60">Platform-wide overview across all organizations.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Plant Owners" value={stats.totalPlantOwners} href="/admin/plant-owners" />
        <StatCard label="Energy Traders" value={stats.totalEnergyTraders} href="/admin/traders" />
        <StatCard
          label="Unassigned Plant Owners"
          value={stats.unassignedPlantOwners}
          href="/admin/assignments"
        />
        <StatCard label="Platform Admins" value={stats.totalPlatformAdmins} href="/admin/users" />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent Activity</h2>
          <Link href="/admin/audit-log" className="text-sm text-blue-400 hover:text-blue-300">
            View all
          </Link>
        </div>

        {stats.recentAuditLog.length === 0 ? (
          <p className="mt-4 text-white/50">No administrative activity yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {stats.recentAuditLog.map((entry) => (
              <li key={entry.id} className="text-sm text-white/70">
                <span className="text-white">
                  {resolveUserDisplayName(entry.actor) ?? entry.actor.email}
                </span>{" "}
                {ACTION_LABELS[entry.action] ?? entry.action}
                {entry.target && (
                  <>
                    {" "}
                    for{" "}
                    <span className="text-white">
                      {resolveUserDisplayName(entry.target) ?? entry.target.email}
                    </span>
                  </>
                )}
                <span className="text-white/40"> — {entry.createdAt.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
