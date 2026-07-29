import { listAuditLog } from "@/lib/admin/queries";

export { pageHeading } from "./heading";

const ACTION_LABELS: Record<string, string> = {
  user_activated: "User activated",
  user_deactivated: "User deactivated",
  user_profile_updated: "User profile updated",
  user_email_changed: "User email changed",
  trader_profile_updated: "Trader profile updated",
  trader_assigned: "Trader assigned",
  trader_changed: "Trader changed",
  trader_removed: "Trader removed",
};

export default async function AdminAuditLogPage() {
  const entries = await listAuditLog();

  return (
    <div className="space-y-6">
      <p className="text-white/60">Every administrative action taken across the platform, most recent first.</p>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-white/50">
            <tr>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                <td className="px-4 py-3 text-white/70">{entry.actor.name ?? entry.actor.email}</td>
                <td className="px-4 py-3 text-white/70">
                  {entry.target ? (entry.target.name ?? entry.target.email) : "—"}
                </td>
                <td className="px-4 py-3 text-white/70">{entry.createdAt.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {entries.length === 0 && <p className="p-6 text-white/50">No administrative activity yet.</p>}
      </div>
    </div>
  );
}
