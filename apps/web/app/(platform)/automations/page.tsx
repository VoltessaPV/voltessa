import { HuaweiControlCard } from "@/components/automations/HuaweiControlCard";
import { HuaweiDiagnosticTestsCard } from "@/components/automations/HuaweiDiagnosticTestsCard";
import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import {
  DIAGNOSTIC_DEFINITIONS,
  getOrgHuaweiDiagnosticTargets,
} from "@/lib/fusionsolar/diagnostic-tests";

export { pageHeading } from "./heading";

export default async function AutomationsPage() {
  const user = await requirePermission(Permissions.canOperatePlants);
  const targets = await getOrgHuaweiDiagnosticTargets(user.organizationId);

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
          definitions={DIAGNOSTIC_DEFINITIONS.map(({ id, label }) => ({
            id,
            label,
          }))}
        />
      </div>
    </div>
  );
}
