import { prisma } from "@/lib/prisma";

/**
 * Voltessa Gateway provisioning milestone (Aug 2026). Step 3 of 3 (see
 * docs/infrastructure/gateway-provisioning.md): associates an ENROLLED
 * gateway with the organization (and, optionally, the specific plant) it
 * serves, advancing status to ACTIVE. Pure database update - no Headscale
 * interaction here, the gateway's network identity was already established
 * in confirm-enrollment.ts.
 *
 * Enforces the same tenant-isolation rule this codebase already relies on
 * elsewhere: if a plant is given, it must belong to the same organization -
 * never lets a gateway be attached to a plant outside its assigned org.
 *
 * Usage (from the repo root):
 *   pnpm tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/gateway/associate-gateway.ts --gateway-id <id> --organization <organizationId> [--plant <plantId>]
 */

function parseArgs(): { gatewayId: string; organizationId: string; plantId: string | null } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? null : args[i + 1] ?? null;
  };

  const gatewayId = get("--gateway-id");
  const organizationId = get("--organization");
  const plantId = get("--plant");

  if (!gatewayId || !organizationId) {
    console.error("Usage: associate-gateway.ts --gateway-id <id> --organization <organizationId> [--plant <plantId>]");
    process.exit(1);
  }
  return { gatewayId, organizationId, plantId };
}

async function main() {
  const { gatewayId, organizationId, plantId } = parseArgs();

  const gateway = await prisma.gateway.findUnique({ where: { id: gatewayId } });
  if (!gateway) {
    throw new Error(`No Gateway with id "${gatewayId}".`);
  }
  if (gateway.status === "PROVISIONED") {
    throw new Error(`Gateway "${gateway.hostname}" (id=${gateway.id}) is still PROVISIONED - it hasn't confirmed enrollment yet. Run confirm-enrollment.ts first.`);
  }
  if (gateway.status === "REVOKED") {
    throw new Error(`Gateway "${gateway.hostname}" (id=${gateway.id}) is REVOKED - refusing to associate a revoked gateway.`);
  }

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) {
    throw new Error(`No Organization with id "${organizationId}".`);
  }

  if (plantId) {
    const plant = await prisma.plant.findUnique({ where: { id: plantId } });
    if (!plant) {
      throw new Error(`No Plant with id "${plantId}".`);
    }
    if (plant.organizationId !== organizationId) {
      throw new Error(`Plant "${plant.name}" (id=${plant.id}) belongs to organization "${plant.organizationId}", not "${organizationId}" - refusing a cross-tenant association.`);
    }
  }

  const updated = await prisma.gateway.update({
    where: { id: gateway.id },
    data: {
      organizationId,
      plantId,
      associatedAt: new Date(),
      status: "ACTIVE",
    },
  });

  console.log(`[associate-gateway] Gateway "${updated.hostname}" (id=${updated.id}) is now ACTIVE - organization=${organizationId}${plantId ? `, plant=${plantId}` : " (no specific plant yet)"}.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[associate-gateway] FAILED", err);
  await prisma.$disconnect();
  process.exit(1);
});
