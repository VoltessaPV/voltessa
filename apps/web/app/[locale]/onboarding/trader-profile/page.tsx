import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { resolveTraderOnboardingStage } from "@/lib/auth/trader-onboarding";
import { getBulgarianDistributionOperators } from "@/lib/market/distribution/bg";
import { prisma } from "@/lib/prisma";

import { completeTraderOnboarding } from "../actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-blue-500";
// [color-scheme:dark] + optionStyle: same fix as
// app/dev/huawei-api/HuaweiDiagnosticTestsCard.tsx's selectClassName -
// native <option> popups don't inherit background-color from the
// <select>, so without this they render on the browser's default opaque
// white surface under our white option text.
const selectClassName =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-blue-500 [color-scheme:dark]";
const optionStyle = { backgroundColor: "#0f172a", color: "#f8fafc" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "All fields are required.",
  invalid_distribution_company: "Select a valid distribution company.",
};

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function TraderProfileOnboardingPage({ searchParams }: Props) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      accountType: true,
      firstName: true,
      lastName: true,
      phone: true,
      traderProfile: {
        select: { companyName: true, distributionCompanyId: true },
      },
    },
  });

  if (!user) {
    redirect("/login");
  }

  if (user.accountType !== "ENERGY_TRADER") {
    redirect("/onboarding");
  }

  // Redirect onward if this step is already done - this page is a
  // one-time onboarding step, not a general profile editor (that's
  // Settings > Profile, for the fields it already covers).
  const stage = await resolveTraderOnboardingStage(user.id);
  if (stage === "active") {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const operators = getBulgarianDistributionOperators();

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050816] px-6 py-12 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-semibold">Complete your Trader Profile</h1>

        <p className="mt-2 text-sm text-white/60">
          A Platform Administrator will review your profile and assign you to one or more
          organizations. All fields are required.
        </p>

        {error && (
          <div className="mt-6 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
            {ERROR_MESSAGES[error] ?? "Something went wrong."}
          </div>
        )}

        <form action={completeTraderOnboarding} className="mt-8 space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <label>
              <span className="text-sm font-medium text-white/80">First name</span>
              <input
                name="firstName"
                required
                defaultValue={user.firstName ?? ""}
                className={inputClassName}
              />
            </label>

            <label>
              <span className="text-sm font-medium text-white/80">Last name</span>
              <input
                name="lastName"
                required
                defaultValue={user.lastName ?? ""}
                className={inputClassName}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-white/80">Phone</span>
            <input
              name="phone"
              type="tel"
              required
              defaultValue={user.phone ?? ""}
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-white/80">Company name</span>
            <input
              name="companyName"
              required
              defaultValue={user.traderProfile?.companyName ?? ""}
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-white/80">Distribution company</span>
            <select
              name="distributionCompanyId"
              required
              defaultValue={user.traderProfile?.distributionCompanyId ?? ""}
              className={selectClassName}
            >
              <option value="" disabled style={optionStyle}>
                Select a distribution company…
              </option>
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id} style={optionStyle}>
                  {operator.officialBulgarianName}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold transition hover:bg-blue-500"
          >
            Submit Profile
          </button>
        </form>
      </div>
    </main>
  );
}
