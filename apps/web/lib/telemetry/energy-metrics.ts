import type { DeviceTelemetry } from "@prisma/client";

import {
  getPlantTelemetryRange,
  INVERTER_DEV_TYPE_ID,
  METER_DEV_TYPE_ID,
} from "@/lib/telemetry/queries";

/**
 * Derived telemetry computations — energy (kWh) and peak production, built
 * only on top of `lib/telemetry/queries.ts`. Nothing here calls Prisma
 * directly and nothing here calls Huawei; it only does arithmetic over
 * already-fetched `DeviceTelemetry` rows.
 *
 * Deliberately does NOT compute revenue, profit, savings, or
 * self-consumption — those are excluded even from the telemetry table
 * itself (see ADR-007) and stay out of this module too.
 *
 * ## Meter counter fields — empirically confirmed meaning (Historical
 * Backfill + Timeline Alignment / Mathematical Correctness milestone)
 *
 * `DeviceTelemetry.activeEnergy` (Huawei `dataItemMap.active_cap`) and
 * `.reverseActiveEnergy` (`reverse_active_cap`) are real cumulative energy
 * counters, not instantaneous readings — confirmed by querying every real
 * meter row for this plant and checking monotonicity: across 2116 samples
 * spanning 8 days, **zero** decreases were observed in either field (only
 * increases or flat periods), which is exactly how a physical energy meter
 * counter behaves and instantaneous power never does.
 *
 * Critically, **the schema's original doc comments had the two fields'
 * real-world meaning backwards.** They were written assuming Huawei's
 * "active"/"forward" naming meant grid import and "reverse" meant export —
 * a plausible-sounding assumption that turned out to be wrong for this
 * meter. Proven instead by correlating each counter's increments against
 * the same row's `meterActivePower` sign:
 *
 * - `activeEnergy` increases essentially **only** while `meterActivePower`
 *   is positive (verified: a 25-minute daytime window with power rising
 *   from 39 kW to 60 kW moved `activeEnergy` by +19.38 kWh, matching a
 *   left-Riemann integration of that same power window, 19.57 kWh, to
 *   within 1%) — i.e. `activeEnergy` is the real cumulative **export**
 *   counter.
 * - `reverseActiveEnergy` increases essentially only while
 *   `meterActivePower` is negative (verified similarly against overnight
 *   standby-import windows) — i.e. `reverseActiveEnergy` is the real
 *   cumulative **import** counter.
 *
 * This matches the existing, independently-derived power-sign convention
 * already used elsewhere in this module (`exportKw = max(power, 0)`,
 * `importKw = max(-power, 0)`) — that convention was correct; only the
 * *counter field labels* were backwards. See
 * `docs/research/telemetry-consumer-migration.md` §13 for the full
 * investigation and cross-checks. `prisma/schema.prisma`'s doc comments
 * have been corrected to match.
 *
 * Because real counters exist for export/import energy, this module now
 * derives `exportedKwh`/`importedKwh` from counter *differences*
 * (`getPlantSettlementEnergySeries`/`sumSettlementEnergy` below) instead of
 * integrating instantaneous power — a counter difference is what a human
 * reading the meter twice would get, strictly more accurate than
 * numerically integrating 5-minute power samples. Power integration is
 * kept only for `producedKwh`, since inverters have no equivalent typed
 * cumulative-energy column in this table (Huawei's `day_cap`/`total_cap`
 * fields exist only in `rawPayload`, not backfilled into a typed column —
 * building that out is explicit future work, not done here).
 *
 * ## `peakExport` (Final Market UI Polish milestone)
 *
 * `peakExport` is the plant's peak *meter* export power (`exportKw` —
 * `max(meterActivePower, 0)`), not peak *inverter* production power.
 * This was a real, found-and-fixed bug: the field used to be called
 * `peakProduction` and was computed from inverter `productionKw`, which
 * for this plant's inverters reads consistently near-zero (confirmed:
 * 0.07 kW all day) even while the meter shows genuine export up to
 * ~60 kW at the same timestamps — a real, plant-specific inverter-vs-meter
 * measurement discrepancy (see the `activeEnergy`/`reverseActiveEnergy`
 * investigation above for the same inverter-telemetry quirk surfacing
 * elsewhere). Both `dashboard/page.tsx` and the Market page read this same
 * field, so they can never diverge — the discrepancy the milestone
 * reported (Market showing ~0.07 kW, Dashboard showing a much larger
 * number) was exactly this: two different underlying quantities
 * (production vs. export) rendered under confusingly similar labels, not
 * a data or timing bug.
 */

/**
 * Consecutive samples more than this far apart are treated as a genuine
 * data gap, not integrated across — attributing the last known power to
 * an hours-long gap would be estimating, not deriving, energy. Real
 * samples are on a confirmed 5-minute grid, so 15 minutes gives headroom
 * for an occasional missed sample without bridging a real outage.
 */
const MAX_INTEGRATION_GAP_MS = 15 * 60 * 1000;

export type PlantTelemetrySeriesPoint = {
  timestamp: Date;
  /** Sum of every inverter that reported at this exact timestamp. `null` if none did — never assumed to be zero. */
  productionKw: number | null;
  /** `max(meterActivePower, 0)` — `null` only if no meter sample exists at this timestamp. */
  exportKw: number | null;
  /** `max(-meterActivePower, 0)` — `null` only if no meter sample exists at this timestamp. */
  importKw: number | null;
};

export type PlantEnergyMetrics = {
  /** `false` only when there is literally no telemetry in the window — every numeric field is then `0`, never a fabricated fallback. */
  available: boolean;
  producedKwh: number;
  exportedKwh: number;
  importedKwh: number;
  /** Peak *meter export* power (not inverter production power) — see this module's `peakExport` doc comment above. */
  peakExport: { kw: number; timestamp: Date } | null;
  latestSampleAt: Date | null;
  sampleCount: number;
};

/**
 * Production-only subset of `PlantEnergyMetrics` — what
 * `computeEnergyMetricsFromSeries` can honestly derive from the power
 * series alone. Deliberately excludes `exportedKwh`/`importedKwh`: those
 * are no longer computed by integrating power (see this module's doc
 * comment) — only `computePlantEnergyMetrics` produces the full,
 * counter-corrected `PlantEnergyMetrics`.
 */
export type PlantProductionSeriesMetrics = {
  available: boolean;
  producedKwh: number;
  /** Peak *meter export* power (not inverter production power) — see this module's `peakExport` doc comment above. */
  peakExport: { kw: number; timestamp: Date } | null;
  latestSampleAt: Date | null;
  sampleCount: number;
};

function integrateKwh(
  points: Array<{ timestamp: Date; kw: number | null }>,
): number {
  let totalKwh = 0;

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];

    if (!previous || !current || previous.kw === null) {
      continue;
    }

    const gapMs = current.timestamp.getTime() - previous.timestamp.getTime();

    if (gapMs <= 0 || gapMs > MAX_INTEGRATION_GAP_MS) {
      continue;
    }

    totalKwh += previous.kw * (gapMs / 3_600_000);
  }

  return totalKwh;
}

/**
 * A real, timestamp-aligned production/export/import series for a plant
 * over `[start, end)` — no fabrication, no interpolation, no carried-
 * forward values. Every point reflects only samples that actually exist at
 * that exact timestamp.
 */
export async function getPlantTelemetrySeries(
  plantId: string,
  start: Date,
  end: Date,
): Promise<PlantTelemetrySeriesPoint[]> {
  const rows = await getPlantTelemetryRange({ plantId, start, end });

  const byTimestamp = new Map<
    number,
    { productionKw: number | null; meterKw: number | null }
  >();

  for (const row of rows) {
    const t = row.timestamp.getTime();
    const entry = byTimestamp.get(t) ?? {
      productionKw: null,
      meterKw: null,
    };

    if (row.devTypeId === INVERTER_DEV_TYPE_ID && row.activePower !== null) {
      entry.productionKw =
        (entry.productionKw ?? 0) + Number(row.activePower);
    }

    if (
      row.devTypeId === METER_DEV_TYPE_ID &&
      row.meterActivePower !== null
    ) {
      entry.meterKw = Number(row.meterActivePower);
    }

    byTimestamp.set(t, entry);
  }

  return [...byTimestamp.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, entry]) => ({
      timestamp: new Date(t),
      productionKw: entry.productionKw,
      exportKw: entry.meterKw !== null ? Math.max(entry.meterKw, 0) : null,
      importKw: entry.meterKw !== null ? Math.max(-entry.meterKw, 0) : null,
    }));
}

/**
 * Pure computation over an already-fetched series — no I/O. Produces only
 * production-side metrics (see `PlantProductionSeriesMetrics`) — this
 * function used to also integrate `exportKw`/`importKw` into
 * `exportedKwh`/`importedKwh`, which this module's doc comment now proves
 * was less accurate than the real meter counters. Callers that need
 * export/import energy use `getPlantSettlementEnergySeries`/
 * `sumSettlementEnergy` (or `computePlantEnergyMetrics`, which combines
 * both) instead.
 */
export function computeEnergyMetricsFromSeries(
  series: PlantTelemetrySeriesPoint[],
): PlantProductionSeriesMetrics {
  if (series.length === 0) {
    return {
      available: false,
      producedKwh: 0,
      peakExport: null,
      latestSampleAt: null,
      sampleCount: 0,
    };
  }

  const producedKwh = integrateKwh(
    series.map((p) => ({ timestamp: p.timestamp, kw: p.productionKw })),
  );

  const withExport = series.filter(
    (p): p is PlantTelemetrySeriesPoint & { exportKw: number } =>
      p.exportKw !== null,
  );

  const peakPoint =
    withExport.length > 0
      ? withExport.reduce((max, p) => (p.exportKw > max.exportKw ? p : max))
      : null;

  const lastPoint = series[series.length - 1];

  return {
    available: true,
    producedKwh: Math.round(producedKwh * 100) / 100,
    peakExport: peakPoint
      ? { kw: peakPoint.exportKw, timestamp: peakPoint.timestamp }
      : null,
    latestSampleAt: lastPoint ? lastPoint.timestamp : null,
    sampleCount: series.length,
  };
}

/**
 * A settlement interval's energy (kWh), for one plant, aligned to a fixed
 * grid starting at the query's own `start` boundary — always the SAME
 * boundaries the Market page's price series uses (Sofia local-day bounds,
 * 15-minute steps), so a chart merging this with `MarketPricePoint[]` by
 * timestamp needs no resampling or forward-filling (see
 * `MarketPriceChart.tsx`).
 */
export type SettlementEnergyPoint = {
  intervalStart: Date;
  /**
   * Real exported energy for this interval, derived from the meter's
   * `activeEnergy` counter's value at the interval's end minus its value
   * at the interval's start (both the nearest real reading at or before
   * that boundary — never interpolated). `null` when no real counter
   * reading spans the interval, or when the two readings would imply a
   * negative delta (a genuine counter reset/replacement) — never a
   * fabricated or negative energy value.
   */
  exportedKwh: number | null;
  /** Same derivation, using the meter's `reverseActiveEnergy` counter (the real cumulative import counter — see this module's doc comment). */
  importedKwh: number | null;
};

/**
 * ENTSO-E's real resolution for this bidding zone (confirmed since the
 * original ENTSO-E integration milestone) — settlement intervals are
 * deliberately the same size so exported/imported energy always aligns
 * with a real price interval, never a resampled approximation of one.
 */
export const SETTLEMENT_INTERVAL_MINUTES = 15;

/**
 * How far before `start` to look for a baseline counter reading, so the
 * very first settlement interval of a query still has a real "before"
 * value to diff against (e.g. the last reading from just before a day
 * boundary). Generous relative to the confirmed 5-minute sample grid —
 * covers a multi-hour reporting gap without ever needing to fabricate a
 * baseline.
 */
const COUNTER_BASELINE_LOOKBACK_MS = 6 * 60 * 60 * 1000;

type MeterCounterField = "activeEnergy" | "reverseActiveEnergy";

/**
 * Builds a forward-only "real counter value at or before instant t"
 * lookup from an ascending-by-timestamp row array. Requires `t` to be
 * called in non-decreasing order (true for how `getPlantSettlementEnergySeries`
 * walks its interval grid) — never interpolates between two real readings,
 * only ever returns an actual stored value.
 */
function makeForwardCounterLookup(
  rows: DeviceTelemetry[],
  field: MeterCounterField,
): (t: number) => number | null {
  let index = 0;
  let lastKnownValue: number | null = null;

  return (t: number): number | null => {
    let row = rows[index];

    while (row !== undefined && row.timestamp.getTime() <= t) {
      const value = row[field];

      if (value !== null) {
        lastKnownValue = Number(value);
      }

      index += 1;
      row = rows[index];
    }

    return lastKnownValue;
  };
}

/**
 * Real exported/imported energy (kWh) per settlement interval over
 * `[start, end)`, derived from the meter's cumulative counters — see this
 * module's doc comment for the empirical proof of which counter is which.
 * Never fabricates: an interval with no real counter reading spanning it
 * (or an apparent counter decrease) is `null`, not zero, not interpolated.
 */
export async function getPlantSettlementEnergySeries(
  plantId: string,
  start: Date,
  end: Date,
  intervalMinutes: number = SETTLEMENT_INTERVAL_MINUTES,
): Promise<SettlementEnergyPoint[]> {
  const lookbackStart = new Date(start.getTime() - COUNTER_BASELINE_LOOKBACK_MS);
  const rows = await getPlantTelemetryRange({
    plantId,
    start: lookbackStart,
    end,
    devTypeId: METER_DEV_TYPE_ID,
  });

  const exportAt = makeForwardCounterLookup(rows, "activeEnergy");
  const importAt = makeForwardCounterLookup(rows, "reverseActiveEnergy");

  const stepMs = intervalMinutes * 60 * 1000;
  const points: SettlementEnergyPoint[] = [];

  for (let t = start.getTime(); t < end.getTime(); t += stepMs) {
    const intervalEndMs = t + stepMs;

    const exportStart = exportAt(t);
    const exportEnd = exportAt(intervalEndMs);
    const importStart = importAt(t);
    const importEnd = importAt(intervalEndMs);

    const exportedKwh =
      exportStart !== null && exportEnd !== null && exportEnd >= exportStart
        ? Math.round((exportEnd - exportStart) * 1000) / 1000
        : null;

    const importedKwh =
      importStart !== null && importEnd !== null && importEnd >= importStart
        ? Math.round((importEnd - importStart) * 1000) / 1000
        : null;

    points.push({ intervalStart: new Date(t), exportedKwh, importedKwh });
  }

  return points;
}

/**
 * Sums a settlement-energy series into totals — always the same value a
 * single first-to-last counter diff over the whole window would give,
 * since consecutive intervals telescope exactly (interval N's end reading
 * is interval N+1's start reading). `available` reflects whether at least
 * one interval had real data, not whether every interval did.
 */
export function sumSettlementEnergy(points: SettlementEnergyPoint[]): {
  available: boolean;
  exportedKwh: number;
  importedKwh: number;
  intervalsWithExportData: number;
  intervalsWithImportData: number;
  totalIntervals: number;
} {
  let exportedKwh = 0;
  let importedKwh = 0;
  let intervalsWithExportData = 0;
  let intervalsWithImportData = 0;

  for (const point of points) {
    if (point.exportedKwh !== null) {
      exportedKwh += point.exportedKwh;
      intervalsWithExportData += 1;
    }

    if (point.importedKwh !== null) {
      importedKwh += point.importedKwh;
      intervalsWithImportData += 1;
    }
  }

  return {
    available: intervalsWithExportData > 0 || intervalsWithImportData > 0,
    exportedKwh: Math.round(exportedKwh * 100) / 100,
    importedKwh: Math.round(importedKwh * 100) / 100,
    intervalsWithExportData,
    intervalsWithImportData,
    totalIntervals: points.length,
  };
}

/**
 * Full plant energy metrics for `[start, end)`: production (numerically
 * integrated from inverter power — no cumulative production counter
 * exists in this table, see this module's doc comment) plus exported/
 * imported energy (derived from the meter's real cumulative counters via
 * `getPlantSettlementEnergySeries`/`sumSettlementEnergy` — never power
 * integration, now that a real counter is confirmed to exist).
 */
export async function computePlantEnergyMetrics(
  plantId: string,
  start: Date,
  end: Date,
): Promise<PlantEnergyMetrics> {
  const [series, settlementPoints] = await Promise.all([
    getPlantTelemetrySeries(plantId, start, end),
    getPlantSettlementEnergySeries(plantId, start, end),
  ]);

  const productionMetrics = computeEnergyMetricsFromSeries(series);
  const settlementTotals = sumSettlementEnergy(settlementPoints);

  return {
    available: productionMetrics.available || settlementTotals.available,
    producedKwh: productionMetrics.producedKwh,
    exportedKwh: settlementTotals.exportedKwh,
    importedKwh: settlementTotals.importedKwh,
    peakExport: productionMetrics.peakExport,
    latestSampleAt: productionMetrics.latestSampleAt,
    sampleCount: productionMetrics.sampleCount,
  };
}
