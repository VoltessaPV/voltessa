import { prisma } from "@/lib/prisma";
import { findHeadscaleNodeByHostname } from "./headscale-ssh";

/**
 * Voltessa Gateway provisioning milestone (Aug 2026). Step 2 of 3 (see
 * docs/infrastructure/gateway-provisioning.md): run once the physical unit
 * has actually enrolled (i.e. it now appears in `headscale nodes list`).
 * Correlates the real Headscale node back to the `Gateway` row
 * provision-gateway.ts created, recording its stable identity
 * (headscaleNodeKey/headscaleNodeId) and advancing status to ENROLLED.
 *
 * Safe to re-run: if the Gateway is already ENROLLED or ACTIVE, this just
 * refreshes the recorded Headscale identifiers (e.g. after a unit
 * replacement re-enrolled under the same hostname) without touching
 * organization/plant association or downgrading status.
 *
 * Usage (from the repo root):
 *   pnpm tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/gateway/confirm-enrollment.ts --hostname gw-<name>
 */

function parseArgs(): { hostname: string } {
  const args = process.argv.slice(2);
  const hostnameIndex = args.indexOf("--hostname");
  const hostname = hostnameIndex === -1 ? undefined : args[hostnameIndex + 1];
  if (!hostname) {
    console.error("Usage: confirm-enrollment.ts --hostname <gw-name>");
    process.exit(1);
  }
  return { hostname };
}

async function main() {
  const { hostname } = parseArgs();

  const gateway = await prisma.gateway.findUnique({ where: { hostname } });
  if (!gateway) {
    throw new Error(`No Gateway row for hostname "${hostname}". Run provision-gateway.ts first.`);
  }
  if (gateway.status === "REVOKED") {
    throw new Error(`Gateway "${hostname}" (id=${gateway.id}) is REVOKED. Re-enrolling a revoked gateway is a deliberate decision, not something this script does automatically.`);
  }

  console.log(`[confirm-enrollment] Looking up Headscale node "${hostname}"...`);
  const node = findHeadscaleNodeByHostname(hostname);
  if (!node) {
    throw new Error(`No Headscale node named "${hostname}" found yet. The physical unit hasn't enrolled (or used a different hostname) - nothing to confirm.`);
  }
  if (!node.tags.includes("tag:gateway")) {
    throw new Error(`Headscale node "${hostname}" exists but is not tagged tag:gateway (tags: ${node.tags.join(", ") || "none"}) - refusing to confirm a node that wasn't enrolled through the gateway provisioning flow.`);
  }

  const nextStatus = gateway.status === "PROVISIONED" ? "ENROLLED" : gateway.status;

  const updated = await prisma.gateway.update({
    where: { id: gateway.id },
    data: {
      headscaleNodeKey: node.node_key,
      headscaleNodeId: node.id,
      enrolledAt: gateway.enrolledAt ?? new Date(),
      status: nextStatus,
    },
  });

  console.log(`[confirm-enrollment] Confirmed. Gateway id=${updated.id}, hostname=${updated.hostname}, status=${updated.status}, headscaleNodeId=${updated.headscaleNodeId}, online=${node.online}`);
  if (updated.status === "ENROLLED") {
    console.log("Next: pnpm tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/gateway/associate-gateway.ts --gateway-id " + updated.id + " --organization <organizationId> [--plant <plantId>]");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[confirm-enrollment] FAILED", err);
  await prisma.$disconnect();
  process.exit(1);
});
