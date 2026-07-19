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
  peakProduction: { kw: number; timestamp: Date } | null;
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
 * Pure computation over an already-fetched series — no I/O. Split out so
 * callers that also need the raw series (e.g. the Market chart overlay)
 * can fetch it once via `getPlantTelemetrySeries` and derive both the
 * series and the aggregated metrics from that single query.
 */
export function computeEnergyMetricsFromSeries(
  series: PlantTelemetrySeriesPoint[],
): PlantEnergyMetrics {
  if (series.length === 0) {
    return {
      available: false,
      producedKwh: 0,
      exportedKwh: 0,
      importedKwh: 0,
      peakProduction: null,
      latestSampleAt: null,
      sampleCount: 0,
    };
  }

  const producedKwh = integrateKwh(
    series.map((p) => ({ timestamp: p.timestamp, kw: p.productionKw })),
  );
  const exportedKwh = integrateKwh(
    series.map((p) => ({ timestamp: p.timestamp, kw: p.exportKw })),
  );
  const importedKwh = integrateKwh(
    series.map((p) => ({ timestamp: p.timestamp, kw: p.importKw })),
  );

  const withProduction = series.filter(
    (p): p is PlantTelemetrySeriesPoint & { productionKw: number } =>
      p.productionKw !== null,
  );

  const peakPoint =
    withProduction.length > 0
      ? withProduction.reduce((max, p) =>
          p.productionKw > max.productionKw ? p : max,
        )
      : null;

  const lastPoint = series[series.length - 1];

  return {
    available: true,
    producedKwh: Math.round(producedKwh * 100) / 100,
    exportedKwh: Math.round(exportedKwh * 100) / 100,
    importedKwh: Math.round(importedKwh * 100) / 100,
    peakProduction: peakPoint
      ? { kw: peakPoint.productionKw, timestamp: peakPoint.timestamp }
      : null,
    latestSampleAt: lastPoint ? lastPoint.timestamp : null,
    sampleCount: series.length,
  };
}

/**
 * Produced/exported/imported energy (kWh) and peak production for a plant
 * over `[start, end)`, numerically integrated from real power samples —
 * never a stored or estimated total. Fetches the series itself; use
 * `computeEnergyMetricsFromSeries` directly if the caller already has one.
 */
export async function computePlantEnergyMetrics(
  plantId: string,
  start: Date,
  end: Date,
): Promise<PlantEnergyMetrics> {
  const series = await getPlantTelemetrySeries(plantId, start, end);

  return computeEnergyMetricsFromSeries(series);
}
