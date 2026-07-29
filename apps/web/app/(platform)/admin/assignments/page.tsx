import Link from "next/link";

import { createAssignment } from "../actions";
import {
  listAssignableTraders,
  listTraderAssignments,
  listUnassignedOrganizations,
  resolveUserDisplayName,
} from "@/lib/admin/queries";

export { pageHeading } from "./heading";

// [color-scheme:dark] + optionStyle: same fix as
// app/dev/huawei-api/HuaweiDiagnosticTestsCard.tsx's selectClassName -
// native <option> popups don't inherit background-color from the
// <select>, so without this they render on the browser's default opaque
// white surface under our white option text.
const selectClassName =
  "h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-white outline-none transition focus:border-blue-500 [color-scheme:dark]";
const optionStyle = { backgroundColor: "#0f172a", color: "#f8fafc" };

/** Name + email, so the Energy Trader select clearly represents a person, not their company. */
function traderOptionLabel(trader: {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}) {
  const displayName = resolveUserDisplayName(trader);
  if (!displayName) {
    return trader.email ?? "Unknown";
  }
  return trader.email ? `${displayName} (${trader.email})` : displayName;
}

export default async function AdminAssignmentsPage() {
  const [assignments, unassignedOrganizations, assignableTraders] = await Promise.all([
    listTraderAssignments(),
    listUnassignedOrganizations(),
    listAssignableTraders(),
  ]);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-lg font-medium">New Assignment</h3>

        {unassignedOrganizations.length === 0 ? (
          <p className="mt-4 text-white/50">Every Plant Owner already has an assigned trader.</p>
        ) : assignableTraders.length === 0 ? (
          <p className="mt-4 text-white/50">No active Energy Traders available to assign.</p>
        ) : (
          <form action={createAssignment} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-white/60">Plant Owner</span>
              <select name="organizationId" required className={selectClassName} defaultValue="">
                <option value="" disabled style={optionStyle}>
                  Select a Plant Owner…
                </option>
                {unassignedOrganizations.map((org) => (
                  <option key={org.id} value={org.id} style={optionStyle}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-white/60">Energy Trader</span>
              <select name="traderId" required className={selectClassName} defaultValue="">
                <option value="" disabled style={optionStyle}>
                  Select an Energy Trader…
                </option>
                {assignableTraders.map((trader) => (
                  <option key={trader.id} value={trader.id} style={optionStyle}>
                    {traderOptionLabel(trader)}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500">
              Assign
            </button>
          </form>
        )}
      </section>

      <section className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-white/50">
            <tr>
              <th className="px-4 py-3 font-medium">Plant Owner</th>
              <th className="px-4 py-3 font-medium">Trader</th>
              <th className="px-4 py-3 font-medium">Assigned By</th>
              <th className="px-4 py-3 font-medium">Since</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((assignment) => (
              <tr key={assignment.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/plant-owners/${assignment.organization.id}`}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    {assignment.organization.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-white/70">
                  {assignment.trader.traderProfile?.companyName ??
                    resolveUserDisplayName(assignment.trader) ??
                    assignment.trader.email}
                </td>
                <td className="px-4 py-3 text-white/70">
                  {resolveUserDisplayName(assignment.assignedBy) ?? assignment.assignedBy.email}
                </td>
                <td className="px-4 py-3 text-white/70">{assignment.createdAt.toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {assignments.length === 0 && <p className="p-6 text-white/50">No assignments yet.</p>}
      </section>
    </div>
  );
}
