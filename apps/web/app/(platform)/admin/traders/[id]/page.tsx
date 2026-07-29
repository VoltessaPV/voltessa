import { notFound } from "next/navigation";

import { toggleUserActive, updateTraderProfile } from "../../actions";
import { getEnergyTraderById } from "@/lib/admin/queries";
import { getBulgarianDistributionOperators } from "@/lib/market/distribution/bg";

export { pageHeading } from "./heading";

const inputClassName =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-blue-500";
const selectClassName =
  "mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-white outline-none transition focus:border-blue-500";

const ERROR_MESSAGES: Record<string, string> = {
  email_required: "Email is required.",
  email_taken: "Another user already has that email address.",
  invalid_distribution_company: "Select a valid distribution company.",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function AdminTraderDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;

  const trader = await getEnergyTraderById(id);
  if (!trader) {
    notFound();
  }

  const operators = getBulgarianDistributionOperators();

  const updateAction = updateTraderProfile.bind(null, trader.id);
  const toggleActiveAction = toggleUserActive.bind(null, trader.id);

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-white">
            {trader.traderProfile?.companyName ?? trader.name ?? trader.email}
          </h2>
          <p className="mt-1 text-sm text-white/50">
            Assigned to {trader.traderAssignments.length} Plant Owner
            {trader.traderAssignments.length === 1 ? "" : "s"}
          </p>
        </div>

        <form action={toggleActiveAction}>
          <button
            type="submit"
            className={
              trader.deactivatedAt
                ? "rounded-xl bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500"
                : "rounded-xl bg-red-600 px-4 py-2 font-medium hover:bg-red-500"
            }
          >
            {trader.deactivatedAt ? "Activate" : "Deactivate"}
          </button>
        </form>
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {ERROR_MESSAGES[error] ?? "Something went wrong."}
        </div>
      )}

      {trader.traderAssignments.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-lg font-medium">Assigned Plant Owners</h3>
          <ul className="mt-4 space-y-2">
            {trader.traderAssignments.map(({ organization }) => (
              <li key={organization.id} className="text-sm text-white/70">
                {organization.name}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-white/40">
            Assignments are managed from Plant Owners or the Assignments page.
          </p>
        </div>
      )}

      <form action={updateAction} className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-lg font-medium">Trader Profile</h3>

        <div className="grid gap-6 md:grid-cols-2">
          <label>
            <span className="text-sm text-white/60">Company name</span>
            <input
              name="companyName"
              defaultValue={trader.traderProfile?.companyName ?? ""}
              className={inputClassName}
            />
          </label>

          <label>
            <span className="text-sm text-white/60">Distribution company</span>
            <select
              name="distributionCompanyId"
              defaultValue={trader.traderProfile?.distributionCompanyId ?? ""}
              className={selectClassName}
            >
              <option value="">—</option>
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.officialBulgarianName}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-sm text-white/60">Contact — first name</span>
            <input name="firstName" defaultValue={trader.firstName ?? ""} className={inputClassName} />
          </label>

          <label>
            <span className="text-sm text-white/60">Contact — last name</span>
            <input name="lastName" defaultValue={trader.lastName ?? ""} className={inputClassName} />
          </label>

          <label>
            <span className="text-sm text-white/60">Email</span>
            <input
              name="email"
              type="email"
              required
              defaultValue={trader.email ?? ""}
              className={inputClassName}
            />
          </label>

          <label>
            <span className="text-sm text-white/60">Phone</span>
            <input name="phone" type="tel" defaultValue={trader.phone ?? ""} className={inputClassName} />
          </label>
        </div>

        <button
          type="submit"
          className="w-full rounded-xl bg-blue-600 px-5 py-3 font-medium transition hover:bg-blue-500 sm:w-auto"
        >
          Save Changes
        </button>
      </form>
    </div>
  );
}
