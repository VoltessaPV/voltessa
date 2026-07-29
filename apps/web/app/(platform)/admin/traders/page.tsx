import Link from "next/link";

import { listEnergyTraders } from "@/lib/admin/queries";
import { getBulgarianDistributionOperators } from "@/lib/market/distribution/bg";

export { pageHeading } from "./heading";

export default async function AdminTradersPage() {
  const traders = await listEnergyTraders();
  const operators = getBulgarianDistributionOperators();

  return (
    <div className="space-y-6">
      <p className="text-white/60">Every Energy Trader account and its business profile.</p>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-white/50">
            <tr>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Distribution Company</th>
              <th className="px-4 py-3 font-medium">Assigned Plant Owners</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {traders.map((trader) => (
              <tr key={trader.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/traders/${trader.id}`}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    {trader.traderProfile?.companyName ?? "—"}
                  </Link>
                </td>
                <td className="px-4 py-3 text-white/70">{trader.name ?? "—"}</td>
                <td className="px-4 py-3 text-white/70">{trader.email}</td>
                <td className="px-4 py-3 text-white/70">
                  {operators.find((op) => op.id === trader.traderProfile?.distributionCompanyId)
                    ?.officialBulgarianName ?? "—"}
                </td>
                <td className="px-4 py-3 text-white/70">{trader.traderAssignments.length}</td>
                <td className="px-4 py-3">
                  {trader.deactivatedAt ? (
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

        {traders.length === 0 && <p className="p-6 text-white/50">No Energy Traders yet.</p>}
      </div>
    </div>
  );
}
