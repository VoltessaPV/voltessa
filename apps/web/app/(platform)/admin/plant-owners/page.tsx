import Link from "next/link";

import { listPlantOwnerOrganizations } from "@/lib/admin/queries";

export { pageHeading } from "./heading";

export default async function AdminPlantOwnersPage() {
  const organizations = await listPlantOwnerOrganizations();

  return (
    <div className="space-y-6">
      <p className="text-white/60">Every Plant Owner organization, its plants, and its assigned trader.</p>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-white/50">
            <tr>
              <th className="px-4 py-3 font-medium">Plant Owner</th>
              <th className="px-4 py-3 font-medium">Plants</th>
              <th className="px-4 py-3 font-medium">Assigned Trader</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((org) => (
              <tr key={org.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/plant-owners/${org.id}`}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    {org.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-white/70">{org.plants.length}</td>
                <td className="px-4 py-3 text-white/70">
                  {org.traderAssignment
                    ? org.traderAssignment.trader.name ?? org.traderAssignment.trader.email
                    : "Unassigned"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {organizations.length === 0 && <p className="p-6 text-white/50">No Plant Owners yet.</p>}
      </div>
    </div>
  );
}
