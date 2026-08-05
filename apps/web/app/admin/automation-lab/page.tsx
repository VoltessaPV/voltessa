import { listAutomationLabPlants } from "@/lib/admin/automation-lab-queries";
import { AUTOMATION_CATALOG } from "@/lib/automation/automation-catalog";
import { requirePlatformAdmin } from "@/lib/auth/session";

import { AutomationLabForm } from "./AutomationLabForm";

export { pageHeading } from "./heading";

/**
 * Platform Admin's engineering tool to validate any automation against any
 * plant/organization, across the whole platform - see ADR-018 (Canonical
 * Entity Contract). Every automation this page can run goes through
 * `AutomationService.execute` (`./actions.ts`) - never a vendor module
 * directly - so a second manufacturer adapter needs no change here at all.
 *
 * Atlanta's Chromium automation is not reachable from this page: it only
 * ever calls `AutomationService`, which only ever resolves a
 * `ManufacturerControlAdapter` by `Plant.vendor` - Atlanta's Chromium
 * automation is not, and will never be, registered as one.
 */
export default async function AutomationLabPage() {
  await requirePlatformAdmin();

  const plants = await listAutomationLabPlants();

  return (
    <div className="space-y-6">
      <p className="text-white/60">
        Validate any automation against any plant, across every organization. Every automation here
        runs through the same generic AutomationService the product itself will use - never a
        Huawei-specific shortcut.
      </p>

      <AutomationLabForm plants={plants} catalog={AUTOMATION_CATALOG} />
    </div>
  );
}
