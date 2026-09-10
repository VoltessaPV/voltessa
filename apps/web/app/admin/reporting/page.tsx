import { listReportingPlants } from "@/lib/admin/reporting-queries";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { MAX_REPORT_RANGE_DAYS } from "@/lib/reporting/report-request";

import { ReportingForm } from "./ReportingForm";

export { pageHeading } from "./heading";

export const dynamic = "force-dynamic";

/**
 * Platform Admin's Reporting page (`/admin/reporting`). Extracts clean
 * 15-minute interval energy + price + revenue data for one plant and
 * period as CSV or XLSX. A pure client of Voltessa's canonical
 * telemetry/market-price/revenue functions via `./actions.ts` — this page
 * performs no calculation itself, and every export runs server-side behind
 * `requirePlatformAdmin()`.
 */
export default async function AdminReportingPage() {
  await requirePlatformAdmin();

  const plants = await listReportingPlants();

  return (
    <div className="space-y-6">
      <p className="text-white/60">
        Export 15-minute interval energy, price and revenue data for a plant and period as CSV or
        XLSX. Values come from Voltessa&apos;s canonical telemetry, market-price and revenue logic —
        never a separate calculation. Missing intervals stay blank, never zero. The final row of every
        export is a period TOTAL (energy and revenue summed; price is an export-weighted average,
        never summed).
      </p>

      <ReportingForm plants={plants} maxRangeDays={MAX_REPORT_RANGE_DAYS} />
    </div>
  );
}
