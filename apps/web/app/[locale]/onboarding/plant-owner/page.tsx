import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { auth } from "@/auth";
import { SHOW_LANGUAGE_SWITCHER } from "@/lib/i18n/routing";
import { prisma } from "@/lib/prisma";

import { createOrganization } from "../actions";

export async function generateMetadata() {
  const t = await getTranslations("onboarding.plantOwner");
  return { title: t("title") };
}

/**
 * Trader Workspace milestone. The Plant Owner org-setup form, moved
 * verbatim out of app/onboarding/page.tsx (now the persona-choice screen -
 * see that file) - same content, same action, same guards, just reached
 * one explicit click later instead of being the default landing content.
 */
export default async function PlantOwnerOnboardingPage() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    select: {
      accountType: true,
      organization: {
        select: {
          name: true,
          onboardingCompletedAt: true,
        },
      },
    },
  });

  if (user?.accountType === "ENERGY_TRADER") {
    redirect("/onboarding");
  }

  if (user?.organization?.onboardingCompletedAt) {
    redirect("/dashboard");
  }

  const t = await getTranslations("onboarding.plantOwner");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050816] px-6 text-white">
      <div className="w-full max-w-md">
        {SHOW_LANGUAGE_SWITCHER && (
          <div className="mb-4 flex justify-end">
            <LanguageSwitcher />
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>

          <p className="mt-2 text-sm text-white/60">{t("subtitle")}</p>

          <form action={createOrganization} className="mt-8">
            <label htmlFor="name" className="text-sm font-medium text-white/80">
              {t("organizationNameLabel")}
            </label>

            <input
              id="name"
              name="name"
              type="text"
              required
              defaultValue={user?.organization?.name ?? ""}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none transition focus:border-blue-500"
            />

            <button
              type="submit"
              className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold transition hover:bg-blue-500"
            >
              {t("submitButton")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
