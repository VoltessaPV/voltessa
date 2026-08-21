import { getMlForecastOverview } from "@/lib/admin/ml-forecast-queries";
import { requirePlatformAdmin } from "@/lib/auth/session";

export { pageHeading } from "./heading";

/**
 * D+1 Self-Learning Forecast milestone. Read-only monitoring for the ML
 * forecasting pipeline — per this milestone's own explicit requirement:
 * "I should be able to look at the dashboard and understand whether the
 * system is learning, degrading, or behaving normally" without reading
 * source code. Shows the current champion, its validation metrics
 * (overall, per-plant, per-weather-regime, vs. the physical baseline),
 * model promotion/rejection history, and the most recent real D+1
 * forecast persisted per plant.
 *
 * Entirely separate from the Dashboard's own Forecast card
 * (`PvForecastRecord`) - this page reads only `MlForecastRecord`/
 * `ForecastModelVersion`, never the production physical+hand-tuned
 * pipeline's own data.
 */

type D1Metrics = {
  intervalMaeKw: number;
  intervalRmseKw: number;
  biasKw: number;
  dailyEnergyErrPctMean: number | null;
  peakMaeKw: number | null;
  nIntervalRows: number;
  nDays: number;
};

type ValidationMetrics = {
  stage1HeadToHead?: Record<string, { mae: number; rmse: number; bias: number }>;
  stage2HeadToHead?: Record<string, { mae: number; rmse: number; bias: number }>;
  combinedD1Holdout: D1Metrics;
  physicalBaselineHoldout: D1Metrics;
  perPlant: Record<string, { ml: D1Metrics; physicalOnly: D1Metrics }>;
  perWeatherRegime: Record<string, { ml: D1Metrics; physicalOnly: D1Metrics }>;
  perHorizonTier?: Record<string, { ml: D1Metrics; physicalOnly: D1Metrics }>;
};

const HORIZON_TIER_ORDER = ["SHORT", "MEDIUM", "LONG"];
const HORIZON_TIER_LABEL: Record<string, string> = {
  SHORT: "SHORT (D+1, <=48h — the primary optimization target)",
  MEDIUM: "MEDIUM (<=10 days)",
  LONG: "LONG (>10 days)",
};

function fmt(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined ? "—" : n.toFixed(digits);
}

function MetricsRow({ label, ml, physical }: { label: string; ml: D1Metrics; physical: D1Metrics }) {
  return (
    <tr className="border-t border-white/10">
      <td className="py-2 pr-4 text-sm text-white/80">{label}</td>
      <td className="py-2 pr-4 text-sm tabular-nums text-white">{fmt(ml.intervalMaeKw, 3)} kW</td>
      <td className="py-2 pr-4 text-sm tabular-nums text-white/50">{fmt(physical.intervalMaeKw, 3)} kW</td>
      <td className="py-2 pr-4 text-sm tabular-nums text-white">{fmt(ml.peakMaeKw, 2)} kW</td>
      <td className="py-2 pr-4 text-sm tabular-nums text-white">{fmt(ml.dailyEnergyErrPctMean, 2)}%</td>
      <td className="py-2 pr-4 text-sm tabular-nums text-white/50">{ml.nDays}d / {ml.nIntervalRows}r</td>
    </tr>
  );
}

export default async function MlForecastPage() {
  await requirePlatformAdmin();

  const overview = await getMlForecastOverview();
  const metrics = overview.champion?.validationMetrics as ValidationMetrics | undefined;

  return (
    <div className="space-y-8">
      <p className="text-white/60">
        Read-only monitoring for the D+1 self-learning ML forecasting pipeline. Entirely separate from
        the Dashboard&apos;s own Forecast card — the physical+hand-tuned production pipeline is
        untouched by this system. Nothing here is currently trader-facing.
      </p>

      {!overview.champion ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-white/70">No champion model registered yet.</p>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-sm font-medium uppercase tracking-wider text-white/50">Current champion</h2>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-white/50">Version</p>
                <p className="text-sm text-white">{overview.champion.versionLabel}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/50">Family</p>
                <p className="text-sm text-white">{overview.champion.family}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/50">Promoted</p>
                <p className="text-sm text-white">{overview.champion.promotedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/50">Feature schema</p>
                <p className="text-sm text-white">{overview.champion.featureSchemaVersion}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/50">Training window</p>
                <p className="text-sm text-white">
                  {overview.champion.trainingDataStart.toISOString().slice(0, 10)} → {overview.champion.trainingDataEnd.toISOString().slice(0, 10)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-white/50">Training samples</p>
                <p className="text-sm text-white">{overview.champion.trainingSampleCount} rows</p>
              </div>
              <div>
                <p className="text-[11px] text-white/50">Genuine D+1 vintage rows</p>
                <p className="text-sm text-white">
                  {overview.champion.trueVintageSampleCount}
                  {overview.champion.trueVintageSampleCount === 0 && (
                    <span className="ml-1 text-amber-400">(cold start — retrospective replay only)</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-white/50">Plants covered</p>
                <p className="text-sm text-white">{overview.champion.plantsCovered.length}</p>
              </div>
            </div>

            {overview.champion.trueVintageSampleCountByTier && overview.champion.trainingSampleCountByTier && (
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-[11px] uppercase tracking-wider text-white/50">Model maturity by horizon</p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {HORIZON_TIER_ORDER.map((tier) => {
                    const trueCount = overview.champion!.trueVintageSampleCountByTier?.[tier] ?? 0;
                    const totalCount = overview.champion!.trainingSampleCountByTier?.[tier] ?? 0;
                    return (
                      <div key={tier} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                        <p className="text-xs text-white/70">{HORIZON_TIER_LABEL[tier] ?? tier}</p>
                        <p className="mt-1 text-sm text-white">{totalCount} training rows</p>
                        <p className="text-xs">
                          {trueCount > 0 ? (
                            <span className="text-emerald-400">{trueCount} genuine vintage rows</span>
                          ) : (
                            <span className="text-amber-400">cold start — no genuine vintages yet</span>
                          )}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {metrics && (
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-sm font-medium uppercase tracking-wider text-white/50">
                Validation metrics — walk-forward holdout (strictly later, chronologically unseen days)
              </h2>
              <p className="mt-1 text-[11px] text-white/40">
                &quot;Overall&quot; pools every horizon together (SHORT/D+1 rows dominate by count) — see the horizon
                breakdown below to avoid mistaking D+1 maturity for whole-model maturity.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-white/40">
                      <th className="pb-2 pr-4">Scope</th>
                      <th className="pb-2 pr-4">ML MAE</th>
                      <th className="pb-2 pr-4">Physical-only MAE</th>
                      <th className="pb-2 pr-4">Peak MAE</th>
                      <th className="pb-2 pr-4">Daily energy err</th>
                      <th className="pb-2 pr-4">Sample</th>
                    </tr>
                  </thead>
                  <tbody>
                    <MetricsRow label="Overall (pooled, all plants, all horizons)" ml={metrics.combinedD1Holdout} physical={metrics.physicalBaselineHoldout} />
                    {metrics.perHorizonTier &&
                      HORIZON_TIER_ORDER.filter((t) => metrics.perHorizonTier![t]).map((tier) => (
                        <MetricsRow key={tier} label={`Horizon: ${HORIZON_TIER_LABEL[tier] ?? tier}`} ml={metrics.perHorizonTier![tier]!.ml} physical={metrics.perHorizonTier![tier]!.physicalOnly} />
                      ))}
                    {Object.entries(metrics.perPlant).map(([plantId, m]) => (
                      <MetricsRow key={plantId} label={`Plant: ${plantId}`} ml={m.ml} physical={m.physicalOnly} />
                    ))}
                    {Object.entries(metrics.perWeatherRegime).map(([regime, m]) => (
                      <MetricsRow key={regime} label={`Regime: ${regime}`} ml={m.ml} physical={m.physicalOnly} />
                    ))}
                  </tbody>
                </table>
              </div>
              {metrics.stage1HeadToHead && metrics.stage2HeadToHead && (
                <div className="mt-4 text-[11px] text-white/50">
                  Family head-to-head — Stage 1 (magnitude):{" "}
                  {Object.entries(metrics.stage1HeadToHead).map(([f, m]) => `${f}=${fmt(m.mae, 2)}kWh`).join(", ")} · Stage 2 (shape):{" "}
                  {Object.entries(metrics.stage2HeadToHead).map(([f, m]) => `${f}=${fmt(m.mae, 3)}kW`).join(", ")}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-white/50">Retraining eligibility</h2>
        <p className="mt-1 text-[11px] text-white/40">
          The exact check `scripts/ml/retrain-and-promote.ts` runs before ever exporting data or invoking training — a
          preview of what the next scheduled run will decide, not a separate opinion.
        </p>
        {!overview.retrainEligibility.sinceDate ? (
          <p className="mt-3 text-sm text-white/70">No champion registered yet — nothing to retrain against.</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-white/50">New genuine vintage days needed</p>
                <p className="text-sm text-white">{overview.retrainEligibility.minNewVintageDaysRequired}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/50">Counting since</p>
                <p className="text-sm text-white">{overview.retrainEligibility.sinceDate}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/50">New genuine vintage days so far</p>
                <p className="text-sm text-white">{overview.retrainEligibility.totalNewGenuineVintageDays}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/50">Eligible for next run?</p>
                <p className={`text-sm ${overview.retrainEligibility.eligible ? "text-emerald-400" : "text-amber-400"}`}>
                  {overview.retrainEligibility.eligible ? "Yes" : "Not yet"}
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              {overview.retrainEligibility.perPlant.map((p) => (
                <p key={p.plantId} className="text-xs text-white/60">
                  {p.plantName}: {p.newGenuineVintageDays} new genuine vintage day(s)
                </p>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-white/50">
          Live accuracy — trailing {overview.liveAccuracy.windowDays} days (reconciled, not the training-time holdout above)
        </h2>
        <p className="mt-1 text-[11px] text-white/40">
          Same `MlForecastRecord.errorKwh`-adjacent data already stored at reconciliation time, grouped fresh — this is
          how a champion&apos;s accuracy drifting AFTER promotion (e.g. a bias sign flip) becomes visible without waiting
          for the next retrain.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-white/40">
                <th className="pb-2 pr-4">Plant</th>
                <th className="pb-2 pr-4">Horizon</th>
                <th className="pb-2 pr-4">Mean bias</th>
                <th className="pb-2 pr-4">Mean abs. error</th>
                <th className="pb-2 pr-4">Sample</th>
              </tr>
            </thead>
            <tbody>
              {overview.liveAccuracy.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-2 text-sm text-white/50">
                    No reconciled ML forecasts in the trailing window yet.
                  </td>
                </tr>
              ) : (
                overview.liveAccuracy.rows.map((row) => (
                  <tr key={`${row.plantId}-${row.horizonTier}`} className="border-t border-white/10">
                    <td className="py-2 pr-4 text-sm text-white/80">{row.plantName}</td>
                    <td className="py-2 pr-4 text-sm text-white/70">{row.horizonTier}</td>
                    <td className="py-2 pr-4 text-sm tabular-nums text-white">{fmt(row.meanBiasKwh, 3)} kWh</td>
                    <td className="py-2 pr-4 text-sm tabular-nums text-white">{fmt(row.meanAbsErrorKwh, 3)} kWh</td>
                    <td className="py-2 pr-4 text-sm tabular-nums text-white/50">{row.sampleCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-white/50">Most recent D+1 forecast per plant</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-white/40">
                <th className="pb-2 pr-4">Plant</th>
                <th className="pb-2 pr-4">Issued</th>
                <th className="pb-2 pr-4">Regime</th>
                <th className="pb-2 pr-4">Daily total</th>
                <th className="pb-2 pr-4">Peak</th>
                <th className="pb-2 pr-4">Reconciled</th>
              </tr>
            </thead>
            <tbody>
              {overview.recentForecastsByPlant.map((row) => (
                <tr key={row.plantId} className="border-t border-white/10">
                  <td className="py-2 pr-4 text-sm text-white/80">{row.plantName}</td>
                  <td className="py-2 pr-4 text-sm tabular-nums text-white/70">{row.latestIssuedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—"}</td>
                  <td className="py-2 pr-4 text-sm text-white/70">{row.weatherRegime ?? "—"}</td>
                  <td className="py-2 pr-4 text-sm tabular-nums text-white">{fmt(row.dailyTotalKwh, 1)} kWh</td>
                  <td className="py-2 pr-4 text-sm tabular-nums text-white">{fmt(row.peakKw, 1)} kW</td>
                  <td className="py-2 pr-4 text-sm tabular-nums text-white/70">
                    {row.reconciledCount}/{row.intervalCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-white/50">Model version history</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-white/40">
                <th className="pb-2 pr-4">Version</th>
                <th className="pb-2 pr-4">Family</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Created</th>
                <th className="pb-2 pr-4">Reason (if rejected)</th>
              </tr>
            </thead>
            <tbody>
              {overview.modelHistory.map((m) => (
                <tr key={m.id} className="border-t border-white/10">
                  <td className="py-2 pr-4 text-sm text-white/80">{m.versionLabel}</td>
                  <td className="py-2 pr-4 text-sm text-white/70">{m.family}</td>
                  <td className="py-2 pr-4 text-sm">
                    <span
                      className={
                        m.status === "CHAMPION"
                          ? "rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-400"
                          : m.status === "REJECTED"
                            ? "rounded-full bg-red-400/10 px-2 py-0.5 text-red-400"
                            : "rounded-full bg-white/10 px-2 py-0.5 text-white/60"
                      }
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-sm tabular-nums text-white/70">{m.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="py-2 pr-4 text-sm text-white/50">{m.rejectionReason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
