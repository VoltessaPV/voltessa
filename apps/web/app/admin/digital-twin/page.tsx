import { listAutomationLabPlants } from "@/lib/admin/automation-lab-queries";
import { requirePlatformAdmin } from "@/lib/auth/session";

import { DigitalTwinForm } from "./DigitalTwinForm";

export { pageHeading } from "./heading";

/**
 * Platform Admin's capacity-scenario planning tool - a pure UI client of
 * the existing Digital Twin Simulation Engine (`lib/digital-twin/
 * replay-engine.ts`, ADR-018). This page performs no business
 * calculations itself: every number rendered comes from `replay`
 * (capacity-only scenario) via `./actions.ts`. Reuses the exact same
 * cross-organization plant list Automation Lab already built
 * (`listAutomationLabPlants`) rather than a second plant query.
 */
export default async function DigitalTwinPage() {
  await requirePlatformAdmin();

  const plants = await listAutomationLabPlants();

  return (
    <div className="space-y-6">
      <p className="text-white/60">
        Answer &quot;what if this plant was larger?&quot; against real historical telemetry - production,
        import, export, self-consumption, and revenue, replayed at a hypothetical installed capacity.
        Every number here comes from the same Simulation Engine, never a calculation in this page.
      </p>

      <DigitalTwinForm plants={plants} />
    </div>
  );
}
