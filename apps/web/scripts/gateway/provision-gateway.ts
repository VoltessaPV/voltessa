import { prisma } from "@/lib/prisma";
import { findHeadscaleUserId, runHeadscaleJson, type HeadscalePreAuthKey } from "./headscale-ssh";

/**
 * Voltessa Gateway provisioning milestone (Aug 2026). Step 1 of 3 in the
 * gateway provisioning workflow (see
 * docs/infrastructure/gateway-provisioning.md for the full runbook):
 * issues a single-use, short-lived, `tag:gateway`-scoped Headscale
 * preauthkey under the existing "voltessa-gateways" Headscale user, and
 * records a new `Gateway` row (status PROVISIONED) so the enrollment is
 * tracked from its very first step.
 *
 * Deliberately does NOT touch the physical gateway itself - this script
 * only prepares the credential and prints the exact command an operator
 * runs once on the new unit. Reuses the existing Headscale control plane
 * (headscale.voltessa.ai) and the existing "voltessa-gateways"/"tag:gateway"
 * setup from the Remote Management milestone - no new infrastructure.
 *
 * Usage (from the repo root):
 *   pnpm tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/gateway/provision-gateway.ts --hostname gw-<name>
 */

const KEY_EXPIRATION = "1h";
const GATEWAY_HEADSCALE_USER = "voltessa-gateways";
const GATEWAY_TAG = "tag:gateway";

function parseArgs(): { hostname: string } {
  const args = process.argv.slice(2);
  const hostnameIndex = args.indexOf("--hostname");
  const hostname = hostnameIndex === -1 ? undefined : args[hostnameIndex + 1];
  if (!hostname) {
    console.error("Usage: provision-gateway.ts --hostname <gw-name>");
    process.exit(1);
  }
  return { hostname };
}

async function main() {
  const { hostname } = parseArgs();

  const existing = await prisma.gateway.findUnique({ where: { hostname } });
  if (existing) {
    throw new Error(`A Gateway row already exists for hostname "${hostname}" (id=${existing.id}, status=${existing.status}). Choose a different hostname, or use confirm-enrollment.ts if this unit is already provisioned.`);
  }

  console.log(`[provision-gateway] Looking up Headscale user "${GATEWAY_HEADSCALE_USER}"...`);
  const userId = findHeadscaleUserId(GATEWAY_HEADSCALE_USER);

  console.log(`[provision-gateway] Creating a single-use, ${KEY_EXPIRATION} preauthkey tagged ${GATEWAY_TAG}...`);
  const preAuthKey = runHeadscaleJson<HeadscalePreAuthKey>(["preauthkeys", "create", "-u", String(userId), "--expiration", KEY_EXPIRATION, "--tags", GATEWAY_TAG]);

  const gateway = await prisma.gateway.create({
    data: { hostname, status: "PROVISIONED" },
  });

  console.log(`[provision-gateway] Gateway row created: id=${gateway.id}, hostname=${gateway.hostname}, status=${gateway.status}`);
  console.log("");
  console.log("Run this ONCE on the physical unit (key is single-use and expires in " + KEY_EXPIRATION + "):");
  console.log("");
  console.log(
    `  sudo tailscale up --login-server=https://headscale.voltessa.ai --authkey=${preAuthKey.key} --hostname=${hostname} --ssh=false`,
  );
  console.log("");
  console.log(`Then run: pnpm tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/gateway/confirm-enrollment.ts --hostname ${hostname}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[provision-gateway] FAILED", err);
  await prisma.$disconnect();
  process.exit(1);
});
