import Link from "next/link";

import { Permissions } from "@/lib/auth/permissions";
import { requireOnboardedUser } from "@/lib/auth/session";
import { dbMarketPriceProvider } from "@/lib/market-price/provider";
import { getMarketPriceStatus } from "@/lib/market-price/status";
import { prisma } from "@/lib/prisma";

import { updateAutomationSettings } from "./actions";

type SettingsPageProps = {
  searchParams: Promise<{
    fusionsolar?: string;
    reason?: string;
  }>;
};

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const user = await requireOnboardedUser();

  // Mirrors the same `canViewPlants` gate the standalone /plants routes use
  // (Sidebar simplification milestone: plant management moved into Settings,
  // not re-permissioned) - everyone who could see the plant list before can
  // still see it here, nothing more.
  const canViewPlants = Permissions.canViewPlants.includes(user.role);

  const plants = canViewPlants
    ? await prisma.plant.findMany({
        where: {
          organizationId: user.organizationId,
        },
        orderBy: {
          createdAt: "desc",
        },
      })
    : [];

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: user.organizationId,
        provider: "HuaweiFusionSolar",
      },
    },
  });

  const automationSettings = await prisma.automationSettings.findUnique({
    where: {
      organizationId: user.organizationId,
    },
  });

  const currentMarketPrice = await dbMarketPriceProvider.getCurrentPrice();
  const marketPriceStatus = getMarketPriceStatus(currentMarketPrice);

  const params = await searchParams;

  const fusionSolarSuccess =
    params.fusionsolar === "callback_ok" ||
    params.fusionsolar === "token_exchange_ok";

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <p className="text-white/60">
          Manage organization integrations and platform settings.
        </p>
      </div>

      {canViewPlants && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">Power Plants</h2>

          <p className="mt-2 text-sm text-white/60">
            Manage photovoltaic plants, their FusionSolar connection, and
            plant-specific configuration.
          </p>

          <div className="mt-6 border-t border-white/10 pt-6">
            <div className="flex items-center justify-between gap-6">
              <div>
                <h3 className="text-base font-medium">Huawei FusionSolar</h3>

                <p className="mt-2 text-sm text-white/60">
                  Connect your organization to FusionSolar.
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
                  className="rounded-xl bg-blue-600 px-5 py-2 font-medium text-white transition hover:bg-blue-500"
                >
                  {connection ? "Reconnect" : "Connect"}
                </a>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-white/70">
                To connect FusionSolar, authorize Voltessa from your FusionSolar
                account. After authorization, FusionSolar will redirect you back
                to Voltessa.
              </p>
            </div>

            {fusionSolarSuccess && (
              <p className="mt-6 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-300">
                FusionSolar OAuth authorization completed successfully.
              </p>
            )}

            {params.fusionsolar && !fusionSolarSuccess && (
              <p className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                FusionSolar connection failed:{" "}
                {params.reason ?? params.fusionsolar}
              </p>
            )}
          </div>

          <div className="mt-6 border-t border-white/10 pt-6">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-medium">Plants</h3>

              <Link
                href="/plants/new"
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                Add Plant
              </Link>
            </div>

            {plants.length === 0 ? (
              <p className="mt-4 text-sm text-white/60">No plants yet.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {plants.map((plant) => (
                  <li
                    key={plant.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div>
                      <Link
                        href={`/plants/${plant.id}`}
                        className="font-medium text-blue-400 hover:text-blue-300"
                      >
                        {plant.name}
                      </Link>

                      <span className="ml-2 text-sm text-white/60">
                        {plant.vendor} · {plant.timezone}
                      </span>
                    </div>

                    <Link
                      href={`/plants/${plant.id}/edit`}
                      className="text-sm text-white/60 transition hover:text-white"
                    >
                      Edit
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-medium">Automation</h2>

        <p className="mt-2 text-sm text-white/60">
          Automatically limit grid export when the market price falls below your
          minimum export price, and restore it once the price recovers.
        </p>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-white/70">Current market price</p>

            <div className="flex items-center gap-2 text-sm text-white/80">
              <span
                className={`h-2 w-2 rounded-full ${marketPriceStatus.colorClass}`}
              />
              {marketPriceStatus.label}
            </div>
          </div>

          <p className="mt-2 text-2xl font-semibold text-white">
            {currentMarketPrice.available
              ? `${currentMarketPrice.price.price} ${currentMarketPrice.price.currency}/MWh`
              : "—"}
          </p>

          <p className="mt-2 text-xs text-white/50">
            {marketPriceStatus.detail}
            {currentMarketPrice.available
              ? ` · Source: ${currentMarketPrice.price.source}`
              : ""}
          </p>
        </div>

        <form action={updateAutomationSettings} className="mt-6 space-y-6">
          <label className="flex items-center gap-3 text-sm text-white/80">
            <input
              type="checkbox"
              name="automationEnabled"
              defaultChecked={automationSettings?.automationEnabled ?? false}
              className="h-4 w-4 rounded border-white/20 bg-white/5"
            />
            Enable automation
          </label>

          <div>
            <label
              htmlFor="minimumExportPrice"
              className="block text-sm text-white/80"
            >
              Minimum export price (EUR/MWh)
            </label>

            <input
              id="minimumExportPrice"
              type="number"
              name="minimumExportPrice"
              step="0.01"
              min="0"
              defaultValue={
                automationSettings?.minimumExportPrice.toString() ?? "15.00"
              }
              className="mt-2 w-40 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white"
            />
          </div>

          <div>
            <label htmlFor="currency" className="block text-sm text-white/80">
              Currency
            </label>

            <input
              id="currency"
              type="text"
              name="currency"
              maxLength={3}
              defaultValue={automationSettings?.currency ?? "EUR"}
              className="mt-2 w-24 rounded-xl border border-white/10 bg-white/5 px-4 py-2 uppercase text-white"
            />
          </div>

          <div>
            <label
              htmlFor="energyTrader"
              className="block text-sm text-white/80"
            >
              Energy trader
            </label>

            <input
              id="energyTrader"
              type="text"
              name="energyTrader"
              defaultValue={automationSettings?.energyTrader ?? ""}
              placeholder="Optional"
              className="mt-2 w-full max-w-sm rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white"
            />
          </div>

          <button
            type="submit"
            className="rounded-xl bg-blue-600 px-5 py-2 font-medium text-white transition hover:bg-blue-500"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  );
}
