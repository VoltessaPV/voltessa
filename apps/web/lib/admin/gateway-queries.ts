import { prisma } from "@/lib/prisma";

/**
 * Voltessa Gateway milestone (Aug 2026). Read-only listing for the
 * `/admin/gateways` platform admin page - visibility only, following the
 * same "no polling/reconciliation/live status caching" boundary the
 * provisioning workflow itself keeps (see
 * docs/infrastructure/gateway-provisioning.md). Live online/offline state
 * is intentionally NOT queried from Headscale here - this page shows what
 * Voltessa's own database knows (identity, association, lifecycle
 * timestamps), not a live network probe.
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
};

export async function getGatewayList(): Promise<GatewayListRow[]> {
  const gateways = await prisma.gateway.findMany({
    include: {
      organization: { select: { name: true } },
      plant: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

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
  }));
}
