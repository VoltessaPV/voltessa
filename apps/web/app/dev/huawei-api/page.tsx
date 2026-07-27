import { Permissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import {
  DIAGNOSTIC_DEFINITIONS,
  getOrgHuaweiDiagnosticTargets,
  toDiagnosticDefinitionMeta,
  toDiagnosticTargetOption,
} from "@/lib/fusionsolar/diagnostic-tests";

import { HuaweiControlCard } from "./HuaweiControlCard";
import { HuaweiDiagnosticTestsCard } from "./HuaweiDiagnosticTestsCard";

/**
 * Internal engineering tool only - not linked from any navigation.
 * Deliberately outside app/(platform) (mirrors /dev/fusionsolar_atlanta):
 * this route needs its own explicit auth check, since proxy.ts's
 * middleware matcher and (platform)/layout.tsx's requireOnboardedUser()
 * only cover /dashboard and routes nested under (platform).
 *
 * Manual Huawei FusionSolar testing tools, moved unchanged from
 * /automations, which is now the end-user automation configuration page
 * (see app/(platform)/automations).
 */
export const metadata = {
  robots: { index: false, follow: false },
};

export default async function HuaweiApiTestingPage() {
  const user = await requirePermission(Permissions.canOperatePlants);
  const targets = await getOrgHuaweiDiagnosticTargets(user.organizationId);

  return (
    <div className="min-h-screen bg-[#050816] px-4 py-12 text-white sm:px-8">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Huawei API Testing</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Engineering tools for manually testing the Huawei FusionSolar
            integration. Not part of the end-user product.
          </p>
        </div>

        <HuaweiControlCard />

        <HuaweiDiagnosticTestsCard
          targets={(targets?.targets ?? []).map(toDiagnosticTargetOption)}
          definitions={DIAGNOSTIC_DEFINITIONS.map(toDiagnosticDefinitionMeta)}
        />
      </div>
    </div>
  );
}
