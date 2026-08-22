import { prisma } from "@/lib/prisma";
import { fetchLiveHeadscaleOnlineStateByNodeKey, resolveLiveConnectivity, type LiveConnectivity } from "./headscale-live-status";

/**
 * Voltessa Gateway milestone (Aug 2026). Read-only listing for the
 * `/admin/gateways` platform admin page. Two deliberately separate
 * concepts, per that milestone's own requirement: `status` is the
 * lifecycle field stored in Postgres (PROVISIONED/ENROLLED/ACTIVE/
 * REVOKED) and never changes just because a gateway is temporarily
 * unreachable; `liveConnectivity` is fetched fresh from Headscale on every
 * call (see `headscale-live-status.ts`) and never written back to the
 * database - no polling/reconciliation/caching, a plain page-load lookup.
 */
export type GatewayListRow = {
  id: string;
  hostname: string;
  status: "PROVISIONED" | "ENROLLED" | "ACTIVE" | "REVOKED";
  headscaleNodeId: number | null;
  headscaleNodeKey: string | null;
  organizationName: string | null;
  plantName: string | null;
  enrolledAt: Date | null;
  associatedAt: Date | null;
  createdAt: Date;
  liveConnectivity: LiveConnectivity;
};

export async function getGatewayList(): Promise<GatewayListRow[]> {
  const [gateways, onlineByNodeKey] = await Promise.all([
    prisma.gateway.findMany({
      include: {
        organization: { select: { name: true } },
        plant: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    fetchLiveHeadscaleOnlineStateByNodeKey(),
  ]);

  return gateways.map((g) => ({
    id: g.id,
    hostname: g.hostname,
    status: g.status,
    headscaleNodeId: g.headscaleNodeId,
    headscaleNodeKey: g.headscaleNodeKey,
    organizationName: g.organization?.name ?? null,
    plantName: g.plant?.name ?? null,
    enrolledAt: g.enrolledAt,
    associatedAt: g.associatedAt,
    createdAt: g.createdAt,
    liveConnectivity: resolveLiveConnectivity(g.headscaleNodeKey, onlineByNodeKey),
  }));
}
