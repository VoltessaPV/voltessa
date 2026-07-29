import { notFound, redirect } from "next/navigation";

import { softDeleteUser, toggleUserActive, updateUser } from "../../actions";
import { getUserById, isLastActivePlatformAdmin, resolveUserDisplayName } from "@/lib/admin/queries";
import { requirePlatformAdmin } from "@/lib/auth/session";

export { pageHeading } from "./heading";

const inputClassName =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-blue-500";

const ERROR_MESSAGES: Record<string, string> = {
  email_required: "Email is required.",
  email_taken: "Another user already has that email address.",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function AdminUserDetailPage({ params, searchParams }: Props) {
  const admin = await requirePlatformAdmin();
  const { id } = await params;
  const { error } = await searchParams;

  const user = await getUserById(id);
  if (!user) {
    notFound();
  }

  // Rule 4: Restore/Purge only ever appear on the Deleted Users view.
  if (user.deletedAt) {
    redirect("/admin/users/deleted");
  }

  const updateUserAction = updateUser.bind(null, user.id);
  const toggleActiveAction = toggleUserActive.bind(null, user.id);
  const softDeleteAction = softDeleteUser.bind(null, user.id);

  // An admin can never deactivate/delete their own account, or the last
  // active Platform Admin - hide those actions rather than let a real
  // admin hit the server-side rejection.
  const isSelf = user.id === admin.id;
  const isProtectedAdmin =
    user.isPlatformAdmin && !isSelf && (await isLastActivePlatformAdmin(user.id));
  const canDeactivateOrDelete = !isSelf && !isProtectedAdmin;

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-white">
            {resolveUserDisplayName(user) ?? user.email}
          </h2>
          <p className="mt-1 text-sm text-white/50">
            {user.accountType === "ENERGY_TRADER" ? "Energy Trader" : "Plant Owner"}
            {user.organization ? ` — ${user.organization.name}` : ""}
          </p>
        </div>

        {(user.deactivatedAt || canDeactivateOrDelete) && (
          <div className="flex flex-wrap gap-2">
            <form action={toggleActiveAction}>
              <button
                type="submit"
                className={
                  user.deactivatedAt
                    ? "rounded-xl bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500"
                    : "rounded-xl bg-red-600 px-4 py-2 font-medium hover:bg-red-500"
                }
              >
                {user.deactivatedAt ? "Activate" : "Deactivate"}
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
        <p className="text-xs text-white/40">
          You cannot deactivate or delete your own account.
        </p>
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

      <form action={updateUserAction} className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-lg font-medium">Profile</h3>

        <div className="grid gap-6 md:grid-cols-2">
          <label>
            <span className="text-sm text-white/60">First name</span>
            <input name="firstName" defaultValue={user.firstName ?? ""} className={inputClassName} />
          </label>

          <label>
            <span className="text-sm text-white/60">Last name</span>
            <input name="lastName" defaultValue={user.lastName ?? ""} className={inputClassName} />
          </label>

          <label>
            <span className="text-sm text-white/60">Email</span>
            <input
              name="email"
              type="email"
              required
              defaultValue={user.email ?? ""}
              className={inputClassName}
            />
          </label>

          <label>
            <span className="text-sm text-white/60">Phone</span>
            <input name="phone" type="tel" defaultValue={user.phone ?? ""} className={inputClassName} />
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
