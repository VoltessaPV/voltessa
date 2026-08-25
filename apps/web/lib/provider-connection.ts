import { prisma } from "@/lib/prisma";

/**
 * Phase 1 Sungrow Authentication milestone — architectural audit finding.
 * `lib/telemetry/plant-context.ts`'s `resolvePlantContext` (the function
 * Dashboard/Market/Automations/Bess all call) hardcodes `vendor: "Huawei"`
 * and looks up only a `HuaweiFusionSolar` connection — a real, load-bearing
 * vendor leak, confirmed by direct inspection. Fixing that function itself
 * is out of scope for this phase (it's Dashboard-rendering code, explicitly
 * excluded), and it also encodes a single-plant-per-organization
 * assumption this function does not attempt to resolve either.
 *
 * This is the minimum correction actually required now: a provider-neutral
 * way to answer "does this organization have a connected plant provider,
 * and which one" without any calling code needing to know that means
 * checking two separate, vendor-named tables. It reads both existing
 * connection tables and returns one normalized shape — no schema change,
 * no change to either table, no change to `resolvePlantContext`.
 *
 * Nothing calls this yet (disclosed, not hidden) — Phase 1's own OAuth
 * routes don't need it (they know their own vendor already), and wiring it
 * into a real consumer (a Settings connection-status view, or eventually
 * generalizing `resolvePlantContext` itself) is future work belonging to a
 * later phase, not this one. Its purpose here is solely to ensure a
 * Sungrow connection is resolvable through a provider-neutral read path
 * from the moment it exists, rather than only ever being visible to
 * Sungrow-specific code.
 *
 * Adding a third vendor later means adding one more branch here — never a
 * second copy of this function, and never a change to any caller's own
 * code once one exists.
 */
export type OrganizationProviderConnection =
  | { provider: "Huawei"; connectionId: string }
  | { provider: "Sungrow"; connectionId: string };

export async function getOrganizationProviderConnection(
  organizationId: string,
): Promise<OrganizationProviderConnection | null> {
  const [huawei, sungrow] = await Promise.all([
    prisma.fusionSolarConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: "HuaweiFusionSolar" } },
      select: { id: true },
    }),
    prisma.sungrowConnection.findUnique({
      where: { organizationId },
      select: { id: true },
    }),
  ]);

  if (huawei) {
    return { provider: "Huawei", connectionId: huawei.id };
  }

  if (sungrow) {
    return { provider: "Sungrow", connectionId: sungrow.id };
  }

  return null;
}
