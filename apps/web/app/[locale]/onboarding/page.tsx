import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { auth } from "@/auth";
import { resolveTraderOnboardingStage } from "@/lib/auth/trader-onboarding";
import { SHOW_LANGUAGE_SWITCHER } from "@/lib/i18n/routing";
import { prisma } from "@/lib/prisma";

import { chooseEnergyTraderPersona } from "./actions";

export async function generateMetadata() {
  const t = await getTranslations("onboarding.persona");
  return { title: t("title") };
}

const TRADER_STAGE_ROUTES = {
  profile: "/onboarding/trader-profile",
  // Trader Workflow Simplification milestone: Clients is the Trader's
  // home now (the portfolio overview), not Dashboard.
  active: "/clients",
} as const;

/**
 * Trader Workspace milestone. This page used to render the Plant Owner
 * org-setup form directly, with the Energy Trader path squeezed into a
 * "Not a plant owner?" footnote underneath it - easy to miss, and not a
 * deliberate choice. This is now the persona-choice screen itself: two
 * equally-sized cards, Plant Owner listed first and styled as the primary/
 * filled option (still the common case), Energy Trader a full outlined
 * card rather than disclaimer text. "Continue as Plant Owner" is a plain
 * navigation to /onboarding/plant-owner (PLANT_OWNER is already every
 * account's default - nothing to persist by clicking it); "Continue as
 * Energy Trader" still calls the existing chooseEnergyTraderPersona action,
 * which is the one that actually records the choice.
 */
export default async function OnboardingPage() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      id: true,
      accountType: true,
      organization: {
        select: {
          onboardingCompletedAt: true,
        },
      },
    },
  });

  if (user?.accountType === "ENERGY_TRADER") {
    const stage = await resolveTraderOnboardingStage(user.id);
    redirect(TRADER_STAGE_ROUTES[stage]);
  }

  if (user?.organization?.onboardingCompletedAt) {
    redirect("/dashboard");
  }

  const [t, tTerm] = await Promise.all([
    getTranslations("onboarding.persona"),
    getTranslations("terminology"),
  ]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050816] px-6 py-12 text-white">
      <div className="w-full max-w-lg">
        {SHOW_LANGUAGE_SWITCHER && (
          <div className="mb-4 flex justify-end">
            <LanguageSwitcher />
          </div>
        )}

        <div className="text-center">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-2 text-sm text-white/60">{t("subtitle")}</p>
        </div>

        <div className="mt-8 space-y-4">
          <div className="rounded-2xl border border-blue-500/40 bg-blue-500/10 p-6">
            <h2 className="text-lg font-semibold">{tTerm("plantOwner")}</h2>
            <p className="mt-1 text-sm text-white/70">{t("plantOwnerDescription")}</p>

            <Link
              href="/onboarding/plant-owner"
              className="mt-5 block w-full rounded-xl bg-blue-600 px-4 py-3 text-center font-semibold transition hover:bg-blue-500"
            >
              {t("plantOwnerButton")}
            </Link>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold">{t("traderTitle")}</h2>
            <p className="mt-1 text-sm text-white/70">{t("traderDescription")}</p>

            <form action={chooseEnergyTraderPersona} className="mt-5">
              <button
                type="submit"
                className="w-full rounded-xl border border-white/20 px-4 py-3 text-center font-semibold text-white transition hover:bg-white/10"
              >
                {t("traderButton")}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
