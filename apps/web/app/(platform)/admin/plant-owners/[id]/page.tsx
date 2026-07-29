import { notFound } from "next/navigation";

import { assignTrader, changeTrader, removeTrader } from "../../actions";
import { getPlantOwnerOrganizationById, listAssignableTraders } from "@/lib/admin/queries";

export { pageHeading } from "./heading";

const selectClassName =
  "h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-white outline-none transition focus:border-blue-500";

type Props = {
  params: Promise<{ id: string }>;
};

function traderLabel(trader: { name: string | null; email: string | null }) {
  return trader.name ?? trader.email ?? "Unknown";
}

export default async function AdminPlantOwnerDetailPage({ params }: Props) {
  const { id } = await params;

  const [organization, assignableTraders] = await Promise.all([
    getPlantOwnerOrganizationById(id),
    listAssignableTraders(),
  ]);

  if (!organization) {
    notFound();
  }

  const assignAction = assignTrader.bind(null, organization.id);
  const changeAction = changeTrader.bind(null, organization.id);
  const removeAction = removeTrader.bind(null, organization.id);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white">{organization.name}</h2>
        <p className="mt-1 text-sm text-white/50">
          Created {organization.createdAt.toLocaleDateString()}
        </p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-lg font-medium">Users</h3>
        {organization.users.length === 0 ? (
          <p className="mt-4 text-white/50">No users in this organization.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {organization.users.map((user) => (
              <li key={user.id} className="text-sm text-white/70">
                {user.name ?? user.email}
                {user.deactivatedAt && <span className="ml-2 text-red-300">(deactivated)</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-lg font-medium">Plants</h3>
        {organization.plants.length === 0 ? (
          <p className="mt-4 text-white/50">No plants registered.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {organization.plants.map((plant) => (
              <li key={plant.id} className="text-sm text-white/70">
                {plant.name} — {plant.vendor} — {plant.timezone}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-lg font-medium">Trader Assignment</h3>

        {organization.traderAssignment ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-white/70">
              Currently assigned to{" "}
              <span className="text-white">{traderLabel(organization.traderAssignment.trader)}</span>
            </p>

            <form action={changeAction} className="flex flex-wrap items-center gap-3">
              <select name="traderId" required className={selectClassName} defaultValue="">
                <option value="" disabled>
                  Change to…
                </option>
                {assignableTraders.map((trader) => (
                  <option key={trader.id} value={trader.id}>
                    {trader.traderProfile?.companyName ?? traderLabel(trader)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500"
              >
                Change Trader
              </button>
            </form>

            <form action={removeAction}>
              <button
                type="submit"
                className="rounded-xl bg-red-600 px-4 py-2 font-medium hover:bg-red-500"
              >
                Remove Trader
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-white/50">No trader assigned.</p>

            {assignableTraders.length === 0 ? (
              <p className="text-sm text-white/50">No active Energy Traders available to assign.</p>
            ) : (
              <form action={assignAction} className="flex flex-wrap items-center gap-3">
                <select name="traderId" required className={selectClassName} defaultValue="">
                  <option value="" disabled>
                    Select a trader…
                  </option>
                  {assignableTraders.map((trader) => (
                    <option key={trader.id} value={trader.id}>
                      {trader.traderProfile?.companyName ?? traderLabel(trader)}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500"
                >
                  Assign Trader
                </button>
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
