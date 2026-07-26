import Link from "next/link";

import { Permissions } from "@/lib/auth/permissions";
import { requireOnboardedUser } from "@/lib/auth/session";
import { ensureTelemetryFresh } from "@/lib/fusionsolar/telemetry-sync-service";
import { prisma } from "@/lib/prisma";
import { revalidateTelemetryPagesIfSynced } from "@/lib/telemetry/revalidate-telemetry-pages";

export { pageHeading } from "./heading";

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
    </div>
  );
}
