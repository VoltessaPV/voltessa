import { restoreUser } from "../../actions";
import { getUserPurgeEligibility, listDeletedUsers, resolveUserDisplayName } from "@/lib/admin/queries";
import { PurgeUserButton } from "@/components/admin/PurgeUserButton";

export { pageHeading } from "./heading";

export default async function AdminDeletedUsersPage() {
  const users = await listDeletedUsers();
  const eligibilities = await Promise.all(
    users.map(async (user) => [user.id, await getUserPurgeEligibility(user.id)] as const),
  );
  const eligibilityByUserId = new Map(eligibilities);

  return (
    <div className="space-y-6">
      <p className="text-white/60">
        Soft-deleted users. Restore reverses the deletion. Purge is permanent and only available
        when the account has no business data or history attached.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-white/50">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Account Type</th>
              <th className="px-4 py-3 font-medium">Deleted</th>
              <th className="px-4 py-3 font-medium">Restore</th>
              <th className="px-4 py-3 font-medium">Purge</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const restoreAction = restoreUser.bind(null, user.id);
              const eligibility = eligibilityByUserId.get(user.id) ?? {
                eligible: false,
                blockers: ["Eligibility could not be determined"],
              };

              return (
                <tr key={user.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3">
                    {resolveUserDisplayName(user) ?? "—"}
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
                  <td className="px-4 py-3 text-white/70">
                    {user.deletedAt?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <form action={restoreAction}>
                      <button
                        type="submit"
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500"
                      >
                        Restore
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3">
                    <PurgeUserButton
                      userId={user.id}
                      email={user.email ?? ""}
                      eligible={eligibility.eligible}
                      blockers={eligibility.blockers}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {users.length === 0 && <p className="p-6 text-white/50">No deleted users.</p>}
      </div>
    </div>
  );
}
