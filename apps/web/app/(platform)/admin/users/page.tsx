import Link from "next/link";

import { listUsers } from "@/lib/admin/queries";

export { pageHeading } from "./heading";

export default async function AdminUsersPage() {
  const users = await listUsers();

  return (
    <div className="space-y-6">
      <p className="text-white/60">All users across every organization.</p>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-white/50">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Account Type</th>
              <th className="px-4 py-3 font-medium">Organization</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${user.id}`} className="text-blue-400 hover:text-blue-300">
                    {user.name ?? "—"}
                  </Link>
                  {user.isPlatformAdmin && (
                    <span className="ml-2 rounded-full border border-purple-400/30 bg-purple-400/10 px-2 py-0.5 text-xs text-purple-300">
                      Platform Admin
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-white/70">{user.email}</td>
                <td className="px-4 py-3 text-white/70">
                  {user.accountType === "ENERGY_TRADER" ? "Energy Trader" : "Plant Owner"}
                </td>
                <td className="px-4 py-3 text-white/70">{user.organization?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  {user.deactivatedAt ? (
                    <span className="rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-xs text-red-300">
                      Deactivated
                    </span>
                  ) : (
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-300">
                      Active
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && <p className="p-6 text-white/50">No users yet.</p>}
      </div>
    </div>
  );
}
