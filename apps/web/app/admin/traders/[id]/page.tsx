import { notFound, redirect } from "next/navigation";

import { softDeleteUser, startImpersonation, toggleUserActive, updateTraderProfile } from "../../actions";
import {
  getEnergyTraderById,
  isLastActivePlatformAdmin,
  resolveUserDisplayName,
} from "@/lib/admin/queries";
import { getBulgarianDistributionOperators } from "@/lib/market/distribution/bg";
import { requirePlatformAdmin } from "@/lib/auth/session";

export { pageHeading } from "./heading";

const inputClassName =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-blue-500";
// [color-scheme:dark] + optionStyle: same fix as
// app/dev/huawei-api/HuaweiDiagnosticTestsCard.tsx's selectClassName -
// native <option> popups don't inherit background-color from the
// <select>, so without this they render on the browser's default opaque
// white surface under our white option text.
const selectClassName =
  "mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-white outline-none transition focus:border-blue-500 [color-scheme:dark]";
const optionStyle = { backgroundColor: "#0f172a", color: "#f8fafc" };

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
  const admin = await requirePlatformAdmin();
  const { id } = await params;
  const { error } = await searchParams;

  const trader = await getEnergyTraderById(id);
  if (!trader) {
    notFound();
  }

  // Rule 4: Restore/Purge only ever appear on the Deleted Users view.
  if (trader.deletedAt) {
    redirect("/admin/users/deleted");
  }

  const operators = getBulgarianDistributionOperators();

  const updateAction = updateTraderProfile.bind(null, trader.id);
  const toggleActiveAction = toggleUserActive.bind(null, trader.id);
  const softDeleteAction = softDeleteUser.bind(null, trader.id);

  const isSelf = trader.id === admin.id;
  const isProtectedAdmin =
    trader.isPlatformAdmin && !isSelf && (await isLastActivePlatformAdmin(trader.id));
  const canDeactivateOrDelete = !isSelf && !isProtectedAdmin;

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-white">
            {trader.traderProfile?.companyName ?? resolveUserDisplayName(trader) ?? trader.email}
          </h2>
          <p className="mt-1 text-sm text-white/50">
            Assigned to {trader.traderAssignments.length} Plant Owner
            {trader.traderAssignments.length === 1 ? "" : "s"}
          </p>
        </div>

        {(trader.deactivatedAt || canDeactivateOrDelete) && (
          <div className="flex flex-wrap gap-2">
            {!isSelf && !trader.deactivatedAt && (
              <form action={startImpersonation.bind(null, trader.id)}>
                <button
                  type="submit"
                  className="rounded-xl border border-white/15 px-4 py-2 font-medium text-white/70 transition hover:bg-white/10"
                >
                  Impersonate
                </button>
              </form>
            )}

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

            {canDeactivateOrDelete && (
              <form action={softDeleteAction}>
                <button
                  type="submit"
                  className="rounded-xl border border-red-500/40 px-4 py-2 font-medium text-red-300 transition hover:bg-red-500/10"
                >
                  Delete
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {isSelf && (
        <p className="text-xs text-white/40">You cannot deactivate or delete your own account.</p>
      )}
      {isProtectedAdmin && (
        <p className="text-xs text-white/40">
          This is the last active Platform Admin and cannot be deactivated or deleted.
        </p>
      )}

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
              <option value="" style={optionStyle}>
                —
              </option>
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id} style={optionStyle}>
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
