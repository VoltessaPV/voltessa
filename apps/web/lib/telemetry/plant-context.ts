import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getOrganizationProviderConnection } from "@/lib/provider-connection";

/**
 * Repository-Layer Deduplication milestone. The single place that resolves
 * "which plant and provider connection does this organization's
 * Dashboard/Market page describe" — called exactly once per request by
 * `getDashboardPageData`/`getProductionPageData`, then reused for every
 * subsequent query instead of being re-derived per call (previously: up to
 * 3 separate `Plant` lookups and 3 separate connection lookups per
 * Dashboard render, one pair per repository function that needed
 * freshness-checking — see the Prisma query trace this milestone is based
 * on).
 *
 * Made provider-neutral (Mobile Client Architecture follow-up, ADR-018/
 * ADR-020): this query used to filter `vendor: "Huawei"` and look up only a
 * `FusionSolarConnection`, in violation of ADR-018's own contract
 * (`docs/CANONICAL_ENTITY_CONTRACT.md` names `Plant`/`Device` as canonical,
 * vendor-neutral topology) — a Huawei-only assumption written before
 * Sungrow existed, not a deliberate design decision. `stationCode`/
 * `plantCode` non-null already identifies "has been synced from some
 * connected provider" regardless of which one (Sungrow's own connect flow
 * populates both the same way Huawei's does — see
 * `app/[locale]/(platform)/plants/connect/isolarcloud/actions.ts`), so the
 * vendor filter was redundant, not load-bearing. Connection lookup now
 * reuses the already-existing, already provider-neutral
 * `getOrganizationProviderConnection` (`lib/provider-connection.ts`)
 * instead of a second, Huawei-specific inline query — no new abstraction,
 * no duplicated resolution logic. Provider-specific behavior stays exactly
 * where it already lived, inside `lib/fusionsolar/*`/`lib/isolarcloud/*`;
 * neither is touched by this change.
 *
 * Multi-plant-per-organization is unchanged and out of scope here — still
 * `findFirst`, matching the existing single-plant MVP assumption
 * (`docs/CLIENT_REQUIREMENTS.md`).
 *
 * Resolution only — single responsibility. Telemetry freshness/synchronization
 * is a separate concern owned entirely by `ensureTelemetryFresh`
 * (`lib/fusionsolar/telemetry-sync-service.ts`); this function used to also
 * schedule a background sync as a side effect, but that responsibility
 * moved out (Transparent Freshness milestone) so this stays exactly what
 * its name says: context resolution, nothing more. Callers that need
 * freshness guarantees call `ensureTelemetryFresh` themselves, before
 * calling this.
 */

export type PlantRenderContext = {
  plant: {
    id: string;
    name: string;
    capacityKw: Prisma.Decimal | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
  };
  /** `null` when the organization has no provider connection at all (not yet onboarded, or revoked) — provider-neutral, see `getOrganizationProviderConnection`. */
  connectionId: string | null;
};

export async function resolvePlantContext(
  organizationId: string,
): Promise<PlantRenderContext | null> {
  const plant = await prisma.plant.findFirst({
    where: {
      organizationId,
      stationCode: { not: null },
      plantCode: { not: null },
    },
    select: {
      id: true,
      name: true,
      capacityKw: true,
      latitude: true,
      longitude: true,
    },
  });

  if (!plant) {
    return null;
  }

  const connection = await getOrganizationProviderConnection(organizationId);

  return { plant, connectionId: connection?.connectionId ?? null };
}
