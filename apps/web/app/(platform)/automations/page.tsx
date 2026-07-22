import { HuaweiControlCard } from "@/components/automations/HuaweiControlCard";
import { HuaweiDiagnosticTestsCard } from "@/components/automations/HuaweiDiagnosticTestsCard";
import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import {
  DIAGNOSTIC_DEFINITIONS,
  getOrgHuaweiDiagnosticTargets,
  toDiagnosticDefinitionMeta,
} from "@/lib/fusionsolar/diagnostic-tests";

export { pageHeading } from "./heading";

export default async function AutomationsPage() {
  const user = await requirePermission(Permissions.canOperatePlants);
  const targets = await getOrgHuaweiDiagnosticTargets(user.organizationId);

  // TEMPORARY diagnostic logging — see diagnostic-tests.ts's matching log.
  // Remove once understood. Does not change behavior, only observes.
  console.log("[DiagTargets][STAGE 2: page.tsx, about to pass props]", {
    userId: user.id,
    organizationId: user.organizationId,
    targetsResultIsNull: targets === null,
    propTargetCount: targets?.targets.length ?? 0,
    propTargets: (targets?.targets ?? []).map((t) => ({
      kind: t.kind,
      deviceType: t.deviceType,
      key: t.key,
      label: t.label,
    })),
  });

  return (
    <div>
      <HuaweiControlCard />

      <section className="mt-8">
        <p className="text-white/60">
          Configure plant control strategies and automation rules.
        </p>
      </section>

      <div className="mt-8">
        <HuaweiDiagnosticTestsCard
          targets={targets?.targets ?? []}
          definitions={DIAGNOSTIC_DEFINITIONS.map(toDiagnosticDefinitionMeta)}
        />
      </div>
    </div>
  );
}
