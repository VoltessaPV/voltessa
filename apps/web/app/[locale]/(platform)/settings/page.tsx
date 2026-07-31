import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";

import { BillingCard } from "@/components/settings/BillingCard";
import { EnergyMarketCard } from "@/components/settings/EnergyMarketCard";
import { NotificationsCard } from "@/components/settings/NotificationsCard";
import { PrivacyCookiesCard } from "@/components/settings/PrivacyCookiesCard";
import { ProfileCard } from "@/components/settings/ProfileCard";
import { SecurityCard } from "@/components/settings/SecurityCard";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { PageContainer } from "@/components/platform/layout/PageContainer";
import { Permissions } from "@/lib/auth/permissions";
import { requireCurrentUser, requireOnboardedUser } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { prisma } from "@/lib/prisma";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";


type SettingsPageProps = {
  searchParams: Promise<{
    fusionsolar?: string;
    reason?: string;
  }>;
};

/**
 * Trader Workspace milestone bugfix. An Energy Trader never owns an
 * Organization (`User.organizationId` is always null - they only get
 * access via `TraderAssignment`), so `requireOnboardedUser()` below
 * redirected them to `/onboarding` on every visit, which then bounced a
 * fully-onboarded trader straight to `/dashboard` - the reported bug.
 * Billing/Energy Market/Plants are genuinely organization-scoped and stay
 * Plant Owner only; Profile/Security/Notifications are per-user data with
 * no organization dependency at all, so a trader gets exactly those three,
 * matching "Settings should always remain available for the trader's own
 * account" from the redesign.
 */
async function renderTraderSettings(userId: string, email: string) {
  const [account, fullUser, notificationPreferences] = await Promise.all([
    prisma.account.findFirst({
      where: { userId, provider: "google" },
      select: { provider: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firstName: true, lastName: true, phone: true, passwordHash: true },
    }),
    prisma.notificationPreferences.findUnique({
      where: { userId },
    }),
  ]);

  const t = await getTranslations("settings.page");

  return (
    <PageContainer className="space-y-5">
      <div>
        <p className="text-sm text-slate-500">{t("introTrader")}</p>
      </div>

      <ProfileCard
        firstName={fullUser.firstName}
        lastName={fullUser.lastName}
        email={email}
        phone={fullUser.phone}
        isGoogleConnected={Boolean(account)}
      />

      <SecurityCard
        isGoogleConnected={Boolean(account)}
        hasPassword={Boolean(fullUser.passwordHash)}
      />

      <NotificationsCard
        automationChanges={notificationPreferences?.automationChanges ?? true}
        exportFailures={notificationPreferences?.exportFailures ?? true}
        priceAlerts={notificationPreferences?.priceAlerts ?? false}
        dailySummary={notificationPreferences?.dailySummary ?? false}
        weeklySummary={notificationPreferences?.weeklySummary ?? false}
      />

      <PrivacyCookiesCard />
    </PageContainer>
  );
}

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const identity = await requireCurrentUser();

  if (identity.accountType === "ENERGY_TRADER") {
    return renderTraderSettings(identity.id, identity.email);
  }

  const user = await requireOnboardedUser();

  // Transparent Freshness milestone: Settings renders no telemetry, so it
  // never waits on Huawei - ensureTelemetryFresh's own after()-scheduled
  // background mode nudges a sync only if stale, and this call returns
  // immediately regardless of that outcome. onSettled runs once the sync
  // actually finishes (well after this render has already been sent), so
  // that if the user opens Dashboard/Market next, the data is already
  // fresh rather than requiring them to notice and refresh manually.
  await ensureTelemetryFresh(user.organizationId, {
    mode: "background",
    onSettled: revalidateTelemetryPagesIfSynced,
  });

  // Mirrors the same `canViewPlants` gate the standalone /plants routes use
  // (Sidebar simplification milestone: plant management moved into Settings,
  // not re-permissioned) - everyone who could see the plant list before can
  // still see it here, nothing more. Profile/Security/Billing/Energy
  // Market/Notifications/Danger Zone are personal-account settings with no
  // role gate of their own - every onboarded user manages their own account.
  const canViewPlants = Permissions.canViewPlants.includes(user.role);

  const [
    account,
    fullUser,
    billingInformation,
    energyMarketSettings,
    notificationPreferences,
    plants,
    connection,
  ] = await Promise.all([
    prisma.account.findFirst({
      where: { userId: user.id, provider: "google" },
      select: { provider: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        firstName: true,
        lastName: true,
        phone: true,
        passwordHash: true,
      },
    }),
    prisma.billingInformation.findUnique({
      where: { organizationId: user.organizationId },
    }),
    prisma.energyMarketSettings.findUnique({
      where: { organizationId: user.organizationId },
    }),
    prisma.notificationPreferences.findUnique({
      where: { userId: user.id },
    }),
    canViewPlants
      ? prisma.plant.findMany({
          where: { organizationId: user.organizationId },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    prisma.fusionSolarConnection.findUnique({
      where: {
        organizationId_provider: {
          organizationId: user.organizationId,
          provider: "HuaweiFusionSolar",
        },
      },
    }),
  ]);

  const params = await searchParams;

  const fusionSolarSuccess =
    params.fusionsolar === "callback_ok" ||
    params.fusionsolar === "token_exchange_ok";

  const t = await getTranslations("settings.page");

  return (
    <PageContainer className="space-y-5">
      <div>
        <p className="text-sm text-slate-500">{t("introOwner")}</p>
      </div>

      <ProfileCard
        firstName={fullUser.firstName}
        lastName={fullUser.lastName}
        email={user.email}
        phone={fullUser.phone}
        isGoogleConnected={Boolean(account)}
      />

      <SecurityCard
        isGoogleConnected={Boolean(account)}
        hasPassword={Boolean(fullUser.passwordHash)}
      />

      <BillingCard
        companyName={billingInformation?.companyName ?? null}
        uic={billingInformation?.uic ?? null}
        vatNumber={billingInformation?.vatNumber ?? null}
        country={billingInformation?.country ?? null}
        city={billingInformation?.city ?? null}
        postalCode={billingInformation?.postalCode ?? null}
        address={billingInformation?.address ?? null}
        invoiceEmail={billingInformation?.invoiceEmail ?? null}
      />

      <EnergyMarketCard
        country={energyMarketSettings?.country ?? "Bulgaria"}
        supplierId={energyMarketSettings?.supplierId ?? null}
        dsoId={energyMarketSettings?.dsoId ?? null}
      />

      <NotificationsCard
        automationChanges={notificationPreferences?.automationChanges ?? true}
        exportFailures={notificationPreferences?.exportFailures ?? true}
        priceAlerts={notificationPreferences?.priceAlerts ?? false}
        dailySummary={notificationPreferences?.dailySummary ?? false}
        weeklySummary={notificationPreferences?.weeklySummary ?? false}
      />

      <PrivacyCookiesCard />

      {canViewPlants && (
        <SettingsCard title={t("plantsTitle")} description={t("plantsDescription")}>
          <div>
            <div className="flex items-center justify-between gap-6">
              <div>
                <h3 className="text-sm font-medium text-white">
                  {t("fusionSolarTitle")}
                </h3>

                <p className="mt-1 text-xs text-slate-500">
                  {t("fusionSolarSubtitle")}
                </p>
              </div>

              <div className="flex shrink-0">
                {/*
                  Plain <a>, not next/link, is intentional: this starts the
                  FusionSolar OAuth flow, and Link's prefetching previously
                  triggered that flow before the user actually clicked.
                */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/api/auth/fusionsolar/connect"
                  className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
                >
                  {connection ? t("fusionSolarReconnectButton") : t("fusionSolarConnectButton")}
                </a>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <p className="text-xs text-slate-400">{t("fusionSolarInstructions")}</p>
            </div>

            {fusionSolarSuccess && (
              <p className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
                {t("fusionSolarSuccess")}
              </p>
            )}

            {params.fusionsolar && !fusionSolarSuccess && (
              <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                {t("fusionSolarFailedPrefix")} {params.reason ?? params.fusionsolar}
              </p>
            )}
          </div>

          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-medium text-white">{t("plantsListTitle")}</h3>

              <Link
                href="/plants/new"
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-500"
              >
                {t("addPlantButton")}
              </Link>
            </div>

            {plants.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">{t("noPlantsYet")}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {plants.map((plant) => (
                  <li
                    key={plant.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/plants/${plant.id}`}
                        className="text-sm font-medium text-blue-400 hover:text-blue-300"
                      >
                        {plant.name}
                      </Link>

                      <span className="ml-2 text-xs text-slate-500">
                        {plant.vendor} · {plant.timezone}
                      </span>
                    </div>

                    <Link
                      href={`/plants/${plant.id}/edit`}
                      className="shrink-0 text-xs text-slate-500 transition hover:text-white"
                    >
                      {t("editPlantLink")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SettingsCard>
      )}
    </PageContainer>
  );
}
