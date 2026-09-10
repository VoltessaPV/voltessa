import { requirePlatformAdmin } from "@/lib/auth/session";
import { listReferencePlants } from "@/lib/pv-simulator/reference-plant";

import { PvSimulatorForm } from "./PvSimulatorForm";

export { pageHeading } from "./heading";

export const dynamic = "force-dynamic";

/**
 * Platform Admin's PV Self-Consumption / PV Impact Simulator
 * (`/admin/pv-simulator`). Upload an external customer 15-minute load
 * profile (Excel), pick a real Voltessa PV plant as the production
 * reference, enter a hypothetical PV capacity and a self-consumption /
 * export mode, and see how the customer's grid electricity would change —
 * downloadable as CSV (15-minute detail) or a 4-sheet XLSX
 * (Summary / Monthly Overview / Hourly Profile / 15-Minute Detail).
 *
 * Physical energy only. Every quantity is reused from Voltessa's canonical
 * telemetry (`getPlantProductionEnergySeries`); a later phase can layer
 * ROI on top of the physical output. See ADR-023.
 */
export default async function PvSimulatorPage() {
  await requirePlatformAdmin();

  const referencePlants = await listReferencePlants();

  return (
    <div className="space-y-6">
      <p className="text-white/60">
        Simulate the grid impact of adding PV to an external customer&apos;s load. Upload the
        customer&apos;s 15-minute consumption profile, scale a real Voltessa PV plant&apos;s
        production to a hypothetical capacity, and see the change to grid import, self-consumption,
        export and curtailment — per 15-minute interval, per month, per hour, and for the whole
        period. This is a physical-energy simulator; it uses Voltessa&apos;s canonical telemetry and
        never fabricates data or prices.
      </p>

      <PvSimulatorForm referencePlants={referencePlants} />
    </div>
  );
}
