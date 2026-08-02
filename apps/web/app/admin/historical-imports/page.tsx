import { listOrganizationsForCoverageCalendar } from "@/lib/admin/platform-health";
import { prisma } from "@/lib/prisma";

import { ContinueImportButton, NewHistoricalImportForm } from "./HistoricalImportControls";

export { pageHeading } from "./heading";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-white/10 text-white/60 border-white/20",
  RUNNING: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  COMPLETED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  FAILED: "bg-red-500/15 text-red-400 border-red-500/30",
};

function formatDate(date: Date | null): string {
  return date ? date.toLocaleString() : "—";
}

/**
 * Database-First Architecture milestone. Platform Admin's only page that
 * can trigger a historical Huawei/ENTSO-E import - Dashboard/Market never
 * do (see `lib/historical-data/ensure-day-available.ts`'s module doc
 * comment). Every import here runs as a `HistoricalImportJob`: resumable,
 * idempotent, processed in bounded chunks via the "Continue" action.
 * Dashboard/Market automatically start reflecting whatever gets imported
 * here - they only ever read the database.
 */
export default async function AdminHistoricalImportsPage() {
  const [organizations, jobs] = await Promise.all([
    listOrganizationsForCoverageCalendar(),
    prisma.historicalImportJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        organization: { select: { name: true } },
        createdBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <p className="text-white/60">
        Explicit, admin-triggered historical backfill. Dashboard and Market never call Huawei or ENTSO-E
        themselves - they only read whatever has already been imported here (or automatically, once, at
        onboarding).
      </p>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-medium text-white">Start a new import</h2>
        <div className="mt-4">
          <NewHistoricalImportForm organizations={organizations} />
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-medium text-white">Recent imports</h2>

        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-white/50">
              <tr>
                <th className="px-4 py-2 font-medium">Organization</th>
                <th className="px-4 py-2 font-medium">Range</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Progress</th>
                <th className="px-4 py-2 font-medium">Last run</th>
                <th className="px-4 py-2 font-medium">Started by</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2 text-white">{job.organization.name}</td>
                  <td className="px-4 py-2 text-white/70">
                    {job.rangeStart.toISOString().slice(0, 10)} → {job.rangeEnd.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[job.status]}`}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-white/70">
                    {job.daysAvailable}/{job.daysRequested} days
                  </td>
                  <td className="px-4 py-2 text-white/70">
                    {formatDate(job.lastRunAt)}
                    {job.lastError && <p className="mt-0.5 text-xs text-red-400">{job.lastError}</p>}
                  </td>
                  <td className="px-4 py-2 text-white/50">{job.createdBy.name ?? job.createdBy.email}</td>
                  <td className="px-4 py-2">
                    {job.status === "PENDING" || job.status === "FAILED" ? (
                      <ContinueImportButton jobId={job.id} />
                    ) : null}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-white/50" colSpan={7}>
                    No historical imports yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
