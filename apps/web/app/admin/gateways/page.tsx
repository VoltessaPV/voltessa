import { getGatewayList } from "@/lib/admin/gateway-queries";
import { requirePlatformAdmin } from "@/lib/auth/session";

export { pageHeading } from "./heading";

/**
 * Voltessa Gateway milestone (Aug 2026). Read-only visibility into
 * provisioned/enrolled/associated physical gateways - not a provisioning
 * UI (that stays the three-script CLI workflow documented in
 * docs/infrastructure/gateway-provisioning.md) and not a live fleet
 * monitor (no polling/reconciliation - see that doc's own "deliberately
 * does not do yet" section). A gateway with no plant association still
 * appears here, by design - this is exactly the visibility a gateway
 * awaiting assignment to a not-yet-onboarded plant needs.
 */

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-400/10 text-emerald-400",
  ENROLLED: "bg-sky-400/10 text-sky-400",
  PROVISIONED: "bg-amber-400/10 text-amber-400",
  REVOKED: "bg-red-400/10 text-red-400",
};

function formatTimestamp(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "—";
}

export default async function GatewaysPage() {
  await requirePlatformAdmin();

  const gateways = await getGatewayList();

  return (
    <div className="space-y-8">
      <p className="text-white/60">
        Read-only listing of every provisioned Voltessa Gateway. Association state comes from Voltessa&apos;s own
        database, not a live probe — see docs/infrastructure/gateway-provisioning.md for the enrollment workflow and
        what &quot;live&quot; status would require.
      </p>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-white/50">
          Gateways ({gateways.length})
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-white/40">
                <th className="pb-2 pr-4">Hostname</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Headscale node</th>
                <th className="pb-2 pr-4">Organization</th>
                <th className="pb-2 pr-4">Plant</th>
                <th className="pb-2 pr-4">Enrolled</th>
                <th className="pb-2 pr-4">Associated</th>
              </tr>
            </thead>
            <tbody>
              {gateways.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-2 text-sm text-white/50">
                    No gateways provisioned yet.
                  </td>
                </tr>
              ) : (
                gateways.map((g) => (
                  <tr key={g.id} className="border-t border-white/10">
                    <td className="py-2 pr-4 text-sm text-white/80">{g.hostname}</td>
                    <td className="py-2 pr-4 text-sm">
                      <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLE[g.status] ?? "bg-white/10 text-white/60"}`}>{g.status}</span>
                    </td>
                    <td className="py-2 pr-4 text-sm text-white/70">
                      {g.headscaleNodeId !== null ? `#${g.headscaleNodeId}` : "—"}
                    </td>
                    <td className="py-2 pr-4 text-sm text-white/70">{g.organizationName ?? "—"}</td>
                    <td className="py-2 pr-4 text-sm text-white/70">{g.plantName ?? "—"}</td>
                    <td className="py-2 pr-4 text-sm tabular-nums text-white/70">{formatTimestamp(g.enrolledAt)}</td>
                    <td className="py-2 pr-4 text-sm tabular-nums text-white/70">{formatTimestamp(g.associatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
