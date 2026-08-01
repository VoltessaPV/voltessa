import {
  getDataIntegrityReport,
  getDatabaseHealth,
  getEntsoeHealth,
  getGatewayHealth,
  getHistoricalCoverageCalendar,
  getHistoricalImportHealth,
  getHuaweiHealth,
  getImportHealth,
  getPerformanceMetrics,
  getPlatformLogs,
  getPlatformOverview,
  getSchedulerHealth,
  isVercelApiConfigured,
  listOrganizationsForCoverageCalendar,
  type HealthStatus,
} from "@/lib/admin/platform-health";
import { getDeploymentHealth, getRuntimeErrorGroups } from "@/lib/admin/vercel-api";

export { pageHeading } from "./heading";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Shared presentation helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<HealthStatus, string> = {
  healthy: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  unknown: "bg-white/10 text-white/50 border-white/20",
};

const STATUS_LABELS: Record<HealthStatus, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
  unknown: "Unknown",
};

function StatusBadge({ status }: { status: HealthStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function StatusCard({ label, status }: { label: string; status: HealthStatus }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/50">{label}</p>
      <div className="mt-3">
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-white/50">{label}</p>
      <p className="mt-1 text-sm text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-white/40">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-lg font-medium text-white">{title}</h2>
      {description && <p className="mt-1 text-sm text-white/50">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function formatDate(date: Date | null): string {
  return date ? date.toLocaleString() : "—";
}

function WaitingForVercelToken({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 text-sm text-white/50">
      Waiting for VERCEL_API_TOKEN — {label} requires a Vercel API credential this deployment does not yet have
      configured. This widget activates automatically once <code className="text-white/70">VERCEL_API_TOKEN</code>{" "}
      (and <code className="text-white/70">VERCEL_PROJECT_ID</code>) are set — no code changes needed.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type SearchParams = {
  calendarOrg?: string;
  calendarYear?: string;
  calendarMonth?: string;
  logsOrg?: string;
  logsSearch?: string;
  logsWindow?: string;
};

export default async function AdminOperationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const organizations = await listOrganizationsForCoverageCalendar();

  const now = new Date();
  const calendarYear = params.calendarYear ? Number(params.calendarYear) : now.getUTCFullYear();
  const calendarMonth = params.calendarMonth ? Number(params.calendarMonth) : now.getUTCMonth() + 1;
  const calendarOrgId = params.calendarOrg ?? organizations[0]?.id ?? null;

  const logsWindowDays = params.logsWindow ? Number(params.logsWindow) : 7;
  const logsSince = new Date(now.getTime() - logsWindowDays * 24 * 60 * 60 * 1000);

  const [
    overview,
    huawei,
    entsoe,
    historicalImportHealth,
    schedulers,
    deployments,
    runtimeErrors,
    database,
    dataIntegrity,
    importHealth,
    gateway,
    performance,
    calendarDays,
    logs,
  ] = await Promise.all([
    getPlatformOverview(),
    getHuaweiHealth(),
    getEntsoeHealth(),
    getHistoricalImportHealth(),
    getSchedulerHealth(),
    getDeploymentHealth(),
    getRuntimeErrorGroups(),
    getDatabaseHealth(),
    getDataIntegrityReport(),
    getImportHealth(),
    getGatewayHealth(),
    getPerformanceMetrics(),
    getHistoricalCoverageCalendar(calendarOrgId, calendarYear, calendarMonth),
    getPlatformLogs({
      organizationId: params.logsOrg || undefined,
      since: logsSince,
      search: params.logsSearch || undefined,
      limit: 100,
    }),
  ]);

  return (
    <div className="space-y-6">
      <p className="text-white/60">
        The single operational source of truth for Voltessa — Huawei, ENTSO-E, the FusionSolar gateway,
        schedulers, importers, deployments, and database integrity, all read-only.
      </p>

      {/* Section 1 — Overall Platform Status */}
      <Section title="Overall Platform Status">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <StatusCard label="Platform" status={overview.overall} />
          <StatusCard label="Huawei" status={overview.huawei} />
          <StatusCard label="ENTSO-E" status={overview.entsoe} />
          <StatusCard label="Database" status={overview.database} />
          <StatusCard label="Gateway" status={overview.gateway} />
          <StatusCard label="Schedulers" status={overview.schedulers} />
          <StatusCard label="Imports" status={overview.imports} />
          <StatusCard label="Runtime" status={overview.runtime} />
        </div>
      </Section>

      {/* Section 2 — Huawei */}
      <Section title="Huawei" description="Every FusionSolar gateway request this app has made, instrumented at the single shared client.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Metric label="Last successful request" value={formatDate(huawei.lastSuccessfulRequestAt)} />
          <Metric label="Last failed request" value={formatDate(huawei.lastFailedRequestAt)} />
          <Metric label="Avg response time (24h)" value={huawei.averageResponseTimeMs !== null ? `${huawei.averageResponseTimeMs} ms` : "—"} />
          <Metric label="Requests (24h)" value={huawei.requestsLast24h} />
          <Metric label="Requests (last hour)" value={huawei.requestsLastHour} />
          <Metric label="Current rate" value={`${huawei.currentRequestRatePerMinute}/min`} />
          <Metric label="429 (rate limited)" value={huawei.statusCodeCounts["429"] ?? 0} hint={(huawei.statusCodeCounts["429"] ?? 0) > 0 ? "Huawei is rate-limiting requests" : undefined} />
          <Metric label="401 Unauthorized" value={huawei.statusCodeCounts["401"] ?? 0} />
          <Metric label="403 Forbidden" value={huawei.statusCodeCounts["403"] ?? 0} />
          <Metric label="5xx server errors" value={huawei.statusCodeCounts["5xx"] ?? 0} />
          <Metric label="Timeouts / network failures (24h)" value={huawei.timeoutCount} />
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-white/50">
              <tr>
                <th className="px-4 py-2 font-medium">Connection</th>
                <th className="px-4 py-2 font-medium">Organization</th>
                <th className="px-4 py-2 font-medium">Token status</th>
                <th className="px-4 py-2 font-medium">Token expires</th>
              </tr>
            </thead>
            <tbody>
              {huawei.connections.map((c) => (
                <tr key={c.connectionId} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2 text-white/70">{c.connectionId}</td>
                  <td className="px-4 py-2 text-white/70">{c.organizationId}</td>
                  <td className="px-4 py-2 text-white/70">{c.tokenStatus}</td>
                  <td className="px-4 py-2 text-white/70">{formatDate(c.tokenExpiresAt)}</td>
                </tr>
              ))}
              {huawei.connections.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-white/50" colSpan={4}>
                    No FusionSolar connections.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section 3 — ENTSO-E */}
      <Section title="ENTSO-E">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Metric label="Last successful import" value={formatDate(entsoe.lastSuccessfulImportAt)} />
          <Metric label="Last failed import" value={formatDate(entsoe.lastFailedImportAt)} hint={entsoe.lastFailedImportReason ?? undefined} />
          <Metric label="Latest imported market day" value={entsoe.latestImportedMarketDay ?? "—"} />
          <Metric label="Avg import duration" value={entsoe.averageImportDurationMs !== null ? `${entsoe.averageImportDurationMs} ms` : "—"} />
          <Metric label="Missing market days (30d)" value={entsoe.missingMarketDays.length} />
        </div>

        {entsoe.missingMarketDays.length > 0 && (
          <p className="mt-3 text-xs text-white/50">Missing: {entsoe.missingMarketDays.join(", ")}</p>
        )}

        {entsoe.recentImportErrors.length > 0 && (
          <div className="mt-4 space-y-1">
            <p className="text-xs font-medium text-white/50">Recent import errors</p>
            {entsoe.recentImportErrors.map((e, i) => (
              <p key={i} className="text-xs text-white/40">
                {e.occurredAt.toLocaleString()} — {e.message}
              </p>
            ))}
          </div>
        )}
      </Section>

      {/* Section 4 — Historical Import Health */}
      <Section title="Historical Import Health">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Metric label="Imports (24h)" value={historicalImportHealth.importsLast24h} />
          <Metric label="Imports (7d)" value={historicalImportHealth.importsLast7d} />
          <Metric label="Imports (30d)" value={historicalImportHealth.importsLast30d} />
          <Metric label="Successful (30d)" value={historicalImportHealth.statusCounts["SUCCESS"] ?? 0} />
          <Metric label="Failed (30d)" value={historicalImportHealth.statusCounts["FAILED"] ?? 0} />
          <Metric label="Skipped (30d)" value={historicalImportHealth.statusCounts["SKIPPED"] ?? 0} />
          <Metric label="Avg duration" value={historicalImportHealth.averageDurationMs !== null ? `${historicalImportHealth.averageDurationMs} ms` : "—"} />
          <Metric label="Avg imported days" value={historicalImportHealth.averageImportedDays ?? "—"} />
        </div>
      </Section>

      {/* Section 5 — Scheduler Health */}
      <Section title="Scheduler Health" description="The four Scaleway systemd timers, observed via their own recorded executions.">
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-white/50">
              <tr>
                <th className="px-4 py-2 font-medium">Scheduler</th>
                <th className="px-4 py-2 font-medium">Cadence</th>
                <th className="px-4 py-2 font-medium">Last run</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">Next expected</th>
                <th className="px-4 py-2 font-medium">Success/Fail (30d)</th>
                <th className="px-4 py-2 font-medium">Consecutive failures</th>
                <th className="px-4 py-2 font-medium">Avg / Max duration</th>
              </tr>
            </thead>
            <tbody>
              {schedulers.map((s) => (
                <tr key={s.name} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2 text-white">
                    {s.label}
                    {!s.appearsActive && <span className="ml-2 text-xs text-amber-400">(inactive?)</span>}
                  </td>
                  <td className="px-4 py-2 text-white/60">{s.cadenceDescription}</td>
                  <td className="px-4 py-2 text-white/70">{formatDate(s.lastExecutionAt)}</td>
                  <td className="px-4 py-2">
                    {s.lastExecutionStatus ? (
                      <StatusBadge status={s.lastExecutionStatus === "SUCCESS" ? "healthy" : s.lastExecutionStatus === "FAILED" ? "critical" : "unknown"} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-white/70">{s.lastExecutionDurationMs !== null ? `${s.lastExecutionDurationMs} ms` : "—"}</td>
                  <td className="px-4 py-2 text-white/70">{formatDate(s.nextExecutionAt)}</td>
                  <td className="px-4 py-2 text-white/70">
                    {s.successCount}/{s.failureCount}
                  </td>
                  <td className="px-4 py-2 text-white/70">
                    {s.consecutiveFailures > 0 ? <span className="text-red-400">{s.consecutiveFailures}</span> : 0}
                  </td>
                  <td className="px-4 py-2 text-white/70">
                    {s.averageDurationMs !== null ? `${s.averageDurationMs} ms` : "—"} / {s.maximumDurationMs !== null ? `${s.maximumDurationMs} ms` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section 6 — Runtime Errors */}
      <Section title="Runtime Errors">
        {!isVercelApiConfigured() ? (
          <WaitingForVercelToken label="Runtime error grouping" />
        ) : !runtimeErrors.available ? (
          <p className="text-sm text-red-400">
            {runtimeErrors.reason === "waiting_for_token" ? "Waiting for VERCEL_API_TOKEN." : runtimeErrors.errorMessage}
          </p>
        ) : runtimeErrors.groups.length === 0 ? (
          <p className="text-sm text-white/50">No runtime errors found in the current production deployment&apos;s logs.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-white/50">
                <tr>
                  <th className="px-4 py-2 font-medium">Error</th>
                  <th className="px-4 py-2 font-medium">Occurrences</th>
                  <th className="px-4 py-2 font-medium">Latest</th>
                </tr>
              </thead>
              <tbody>
                {runtimeErrors.groups.map((g, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2 text-white/70">{g.message}</td>
                    <td className="px-4 py-2 text-white/70">{g.occurrences}</td>
                    <td className="px-4 py-2 text-white/70">{g.latestOccurrence.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Section 7 — Deployments */}
      <Section title="Deployments">
        {!isVercelApiConfigured() ? (
          <WaitingForVercelToken label="Deployment history" />
        ) : !deployments.available ? (
          <p className="text-sm text-red-400">
            {deployments.reason === "waiting_for_token" ? "Waiting for VERCEL_API_TOKEN." : deployments.errorMessage}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(["current", "previous", "latestPreview"] as const).map((key) => {
              const deployment = deployments[key];
              const labels = { current: "Current production", previous: "Previous production", latestPreview: "Latest preview" };
              return (
                <div key={key} className="rounded-xl border border-white/10 p-4">
                  <p className="text-xs text-white/50">{labels[key]}</p>
                  {deployment ? (
                    <>
                      <p className="mt-1 text-sm text-white">{deployment.commitSha?.slice(0, 7) ?? deployment.id}</p>
                      <p className="text-xs text-white/40">{deployment.commitBranch ?? "—"}</p>
                      <p className="text-xs text-white/40">{deployment.state}</p>
                      <p className="text-xs text-white/40">{formatDate(deployment.createdAt)}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-white/50">—</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Section 8 — Database */}
      <Section title="Database">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Reachable" value={database.reachable ? "Yes" : "No"} />
          <Metric label="Latency" value={database.latencyMs !== null ? `${database.latencyMs} ms` : "—"} />
          <Metric label="Current connections" value={database.currentConnections ?? "—"} />
          <Metric
            label="Latest recorded migration"
            value={database.latestRecordedMigration ?? "—"}
            hint="Schema changes applied via `prisma db push` do not create a migration record — this reflects only migrate-based history."
          />
        </div>
        {!database.reachable && <p className="mt-3 text-sm text-red-400">{database.errorMessage}</p>}
      </Section>

      {/* Section 9 — Data Integrity */}
      <Section title="Data Integrity" description={`Read-only checks, cached — computed ${new Date(dataIntegrity.computedAt).toLocaleString()}. Never modifies data.`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Metric label="Duplicate PlantDailyKpi" value={dataIntegrity.duplicates.plantDailyKpi.groupCount} />
          <Metric label="Duplicate DeviceTelemetry" value={dataIntegrity.duplicates.deviceTelemetry.groupCount} />
          <Metric label="Duplicate MarketPrice" value={dataIntegrity.duplicates.marketPrice.groupCount} />
          <Metric label="Duplicate ConsentLog" value={dataIntegrity.duplicates.consentLog.groupCount} />
          <Metric label="Duplicate AutomationEvent" value={dataIntegrity.duplicates.automationEvent.groupCount} />
        </div>

        {dataIntegrity.notApplicable.map((na) => (
          <p key={na.label} className="mt-3 text-xs text-white/40">
            {na.label}: not applicable — {na.reason}
          </p>
        ))}

        <div className="mt-5">
          <p className="text-xs font-medium text-white/50">Foreign key integrity (organizationId orphans)</p>
          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {dataIntegrity.orphanRows.map((row) => (
              <Metric key={row.table} label={row.table} value={row.count} />
            ))}
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-white/50">
              <tr>
                <th className="px-4 py-2 font-medium">Organization</th>
                <th className="px-4 py-2 font-medium">Missing telemetry days (30d)</th>
                <th className="px-4 py-2 font-medium">Missing daily KPI days (30d)</th>
                <th className="px-4 py-2 font-medium">Missing market price days (30d)</th>
              </tr>
            </thead>
            <tbody>
              {dataIntegrity.missingDaysByOrganization.map((org) => (
                <tr key={org.organizationId} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2 text-white/70">{org.organizationName}</td>
                  <td className="px-4 py-2 text-white/70">{org.missingTelemetryDays}</td>
                  <td className="px-4 py-2 text-white/70">{org.missingDailyKpiDays}</td>
                  <td className="px-4 py-2 text-white/70">{org.missingMarketPriceDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section 10 — Import Health */}
      <Section title="Import Health" description="Rolling 30-day totals per shared importer entry point.">
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-white/50">
              <tr>
                <th className="px-4 py-2 font-medium">Importer</th>
                <th className="px-4 py-2 font-medium">Last run</th>
                <th className="px-4 py-2 font-medium">Last success</th>
                <th className="px-4 py-2 font-medium">Last failure</th>
                <th className="px-4 py-2 font-medium">Imported</th>
                <th className="px-4 py-2 font-medium">Skipped</th>
                <th className="px-4 py-2 font-medium">Failed</th>
                <th className="px-4 py-2 font-medium">Avg duration</th>
              </tr>
            </thead>
            <tbody>
              {importHealth.map((i) => (
                <tr key={i.importerType} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2 text-white">{i.label}</td>
                  <td className="px-4 py-2 text-white/70">{formatDate(i.lastRunAt)}</td>
                  <td className="px-4 py-2 text-white/70">{formatDate(i.lastSuccessAt)}</td>
                  <td className="px-4 py-2 text-white/70">{formatDate(i.lastFailureAt)}</td>
                  <td className="px-4 py-2 text-white/70">{i.rowsImportedTotal}</td>
                  <td className="px-4 py-2 text-white/70">{i.rowsSkippedTotal}</td>
                  <td className="px-4 py-2 text-white/70">{i.rowsFailedTotal}</td>
                  <td className="px-4 py-2 text-white/70">{i.averageDurationMs !== null ? `${i.averageDurationMs} ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section 11 — FusionSolar Gateway */}
      <Section title="FusionSolar Gateway">
        {!gateway.reachable ? (
          <p className="text-sm text-red-400">Unreachable — {gateway.errorMessage}</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Metric label="Online" value="Yes" />
            <Metric label="Version" value={gateway.version} />
            <Metric label="Node version" value={gateway.nodeVersion} />
            <Metric label="Process uptime" value={`${Math.floor(gateway.uptimeSeconds / 3600)}h ${Math.floor((gateway.uptimeSeconds % 3600) / 60)}m`} />
            <Metric label="Last restart" value={formatDate(gateway.startedAt)} />
            <Metric label="Response latency" value={`${gateway.responseLatencyMs} ms`} />
            <Metric label="CPU usage" value={`${gateway.cpuPercent}%`} hint="Cumulative CPU time / process uptime" />
            <Metric label="Memory (RSS)" value={`${Math.round(gateway.memory.rssBytes / 1024 / 1024)} MB`} />
            <Metric label="Allowed API endpoints" value={gateway.allowedApiPaths.length} />
          </div>
        )}
        {gateway.reachable && (
          <p className="mt-3 text-xs text-white/40">{gateway.allowedApiPaths.join(", ")}</p>
        )}
      </Section>

      {/* Section 12 — Performance */}
      <Section title="Performance">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Metric label="Avg historical import duration" value={performance.historicalImportAverageDurationMs !== null ? `${performance.historicalImportAverageDurationMs} ms` : "—"} />
          <Metric label="Avg telemetry sync duration" value={performance.telemetrySyncAverageDurationMs !== null ? `${performance.telemetrySyncAverageDurationMs} ms` : "—"} />
          <Metric
            label="Largest telemetry sync"
            value={performance.largestTelemetrySync ? `${performance.largestTelemetrySync.rowsImported} rows` : "—"}
            hint={performance.largestTelemetrySync ? formatDate(performance.largestTelemetrySync.occurredAt) : undefined}
          />
          <Metric
            label="Largest historical import"
            value={performance.largestHistoricalImport ? `${performance.largestHistoricalImport.rowsImported} days` : "—"}
            hint={performance.largestHistoricalImport ? formatDate(performance.largestHistoricalImport.occurredAt) : undefined}
          />
          <Metric label="Slowest query" value="Not currently instrumented" />
        </div>
        <div className="mt-4">
          {!isVercelApiConfigured() ? (
            <WaitingForVercelToken label="Dashboard/Market page load time (Vercel Web Analytics)" />
          ) : null}
        </div>
      </Section>

      {/* Section 13 — Historical Coverage */}
      <Section title="Historical Coverage" description="Green = complete, Yellow = partial, Red = missing, Gray = future.">
        <form method="get" className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="logsOrg" value={params.logsOrg ?? ""} />
          <input type="hidden" name="logsSearch" value={params.logsSearch ?? ""} />
          <input type="hidden" name="logsWindow" value={params.logsWindow ?? ""} />
          <select name="calendarOrg" defaultValue={calendarOrgId ?? ""} className="rounded-lg border border-white/10 bg-[#0b1020] px-3 py-1.5 text-white">
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          <select name="calendarYear" defaultValue={String(calendarYear)} className="rounded-lg border border-white/10 bg-[#0b1020] px-3 py-1.5 text-white">
            {Array.from({ length: 5 }, (_, i) => now.getUTCFullYear() - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select name="calendarMonth" defaultValue={String(calendarMonth)} className="rounded-lg border border-white/10 bg-[#0b1020] px-3 py-1.5 text-white">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-white/20 px-3 py-1.5 text-white hover:bg-white/10">
            View
          </button>
        </form>

        <div className="grid grid-cols-7 gap-2">
          {calendarDays.map((day) => {
            const color =
              day.status === "complete"
                ? "bg-emerald-500/70"
                : day.status === "partial"
                  ? "bg-amber-500/70"
                  : day.status === "missing"
                    ? "bg-red-500/70"
                    : "bg-white/10";
            return (
              <div
                key={day.dateStr}
                title={`${day.dateStr}: telemetry=${day.telemetryAvailable}, dailyKpi=${day.dailyKpiAvailable}, marketPrice=${day.marketPriceAvailable}`}
                className={`flex h-10 items-center justify-center rounded-md text-xs text-white/80 ${color}`}
              >
                {day.dateStr.slice(-2)}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Section 14 — Logs */}
      <Section title="Logs" description="Recent platform events — audit log, automation events, and scheduler/importer failures.">
        <form method="get" className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="calendarOrg" value={params.calendarOrg ?? ""} />
          <input type="hidden" name="calendarYear" value={params.calendarYear ?? ""} />
          <input type="hidden" name="calendarMonth" value={params.calendarMonth ?? ""} />
          <select name="logsOrg" defaultValue={params.logsOrg ?? ""} className="rounded-lg border border-white/10 bg-[#0b1020] px-3 py-1.5 text-white">
            <option value="">All organizations</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          <select name="logsWindow" defaultValue={String(logsWindowDays)} className="rounded-lg border border-white/10 bg-[#0b1020] px-3 py-1.5 text-white">
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
          <input
            type="text"
            name="logsSearch"
            defaultValue={params.logsSearch ?? ""}
            placeholder="Search messages..."
            className="rounded-lg border border-white/10 bg-[#0b1020] px-3 py-1.5 text-white placeholder:text-white/30"
          />
          <button type="submit" className="rounded-lg border border-white/20 px-3 py-1.5 text-white hover:bg-white/10">
            Filter
          </button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-white/50">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Message</th>
                <th className="px-4 py-2 font-medium">Organization</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry) => (
                <tr key={entry.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2 text-white/70">{entry.occurredAt.toLocaleString()}</td>
                  <td className="px-4 py-2 text-white/50">{entry.source}</td>
                  <td className="px-4 py-2 text-white/70">{entry.message}</td>
                  <td className="px-4 py-2 text-white/50">{entry.organizationId ?? "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-white/50" colSpan={4}>
                    No events in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
