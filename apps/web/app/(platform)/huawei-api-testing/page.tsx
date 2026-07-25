import { HuaweiControlCard } from "@/components/huawei-api-testing/HuaweiControlCard";
import { HuaweiDiagnosticTestsCard } from "@/components/huawei-api-testing/HuaweiDiagnosticTestsCard";
import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import {
  DIAGNOSTIC_DEFINITIONS,
  getOrgHuaweiDiagnosticTargets,
  toDiagnosticDefinitionMeta,
  toDiagnosticTargetOption,
} from "@/lib/fusionsolar/diagnostic-tests";

export { pageHeading } from "./heading";

/**
 * Internal engineering page only - not linked from AppSidebar navigation,
 * reachable only by direct URL. Manual Huawei FusionSolar testing tools
 * (moved here unchanged from /automations, which is now the end-user
 * automation configuration page - see components/automations/*).
 */
export default async function HuaweiApiTestingPage() {
  const user = await requirePermission(Permissions.canOperatePlants);
  const targets = await getOrgHuaweiDiagnosticTargets(user.organizationId);

  return (
    <div>
      <section className="mb-8">
        <p className="text-white/60">
          Engineering tools for manually testing the Huawei FusionSolar
          integration. Not part of the end-user product.
        </p>
      </section>

      <HuaweiControlCard />

      <div className="mt-8">
        <HuaweiDiagnosticTestsCard
          targets={(targets?.targets ?? []).map(toDiagnosticTargetOption)}
          definitions={DIAGNOSTIC_DEFINITIONS.map(toDiagnosticDefinitionMeta)}
        />
      </div>
    </div>
  );
}
