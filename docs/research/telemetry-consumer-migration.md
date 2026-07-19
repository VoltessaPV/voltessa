# Telemetry Consumer Migration — Engineering Report

Status: **Implemented and verified against production.** Huawei is now a producer only for the
Dashboard and Market pages; both consume `DeviceTelemetry` wherever historical/recent data already
exists there. Neither the UI, the ENTSO-E importer, the telemetry importer, nor automation were
touched.

## 1. The rule this migration follows

Per the milestone: nothing outside the telemetry importer should depend on Huawei unless real-time
state is *absolutely required*. Every FusionSolar read that existed on the Dashboard and Market
pages before this migration was reviewed and placed into exactly one of two categories — no read
was left ambiguous.

## 2. Category A — real-time operational state (kept live, unchanged)

These describe "what is true right now" and have no historical equivalent to substitute — reading
a 5-minute-old `DeviceTelemetry` sample and calling it "current state" would itself be a kind of
fabrication.

| Read | Where | Why it stays live |
|---|---|---|
| `getPlantConfiguredExportControlMode` | Dashboard (per plant), Market (`production-data.ts`) | The plant's configured export-control mode right now — the canonical Category A example given in the milestone. |
| `getPlantCurrentPowerStatus` (current production/export/import) | Market (`production-data.ts`) | A live instantaneous reading — Market's `MarketSummaryCard`s for "Current Production"/"Current Export"/"Current Import" still show this. |

Neither call site changed at all — same functions, same error handling, same "degrade to an
explicit unavailable state, never a fallback" behavior already established.

## 3. Category B — historical/trend data (migrated to `DeviceTelemetry`)

| Read | Before | After |
|---|---|---|
| Market: today's production | `PlantTelemetrySnapshot.dayPower` | `computePlantEnergyMetrics(...).producedKwh` |
| Market: exported/imported energy today | *(didn't exist)* | `computePlantEnergyMetrics(...).exportedKwh` / `.importedKwh` |
| Market: peak production today | *(didn't exist)* | Max of the per-timestamp summed inverter series |
| Market: production/export chart overlay | *(mocked, then removed entirely — see prior milestone)* | Real 5-minute `DeviceTelemetry` series, today only |
| Market: Insights (production-side) | *(price-only insights existed; no production insights)* | 5 new entries: today's production, current export/import, peak production, exported/imported energy — all from telemetry |
| Dashboard: "Energy Today" (per-plant and portfolio) | `PlantTelemetrySnapshot.dayPower` | `computePlantEnergyMetrics(...).producedKwh` |
| Dashboard: "Exported Today" | `PlantTelemetrySnapshot.dayOnGridEnergy` | `computePlantEnergyMetrics(...).exportedKwh` |
| Dashboard: "Consumed Today" | `PlantTelemetrySnapshot.dayUseEnergy` | **Renamed to "Imported Today"**, sourced from `.importedKwh` — see §6 |
| Dashboard: "Last telemetry" timestamp | `PlantTelemetrySnapshot.collectedAt` | Latest `DeviceTelemetry` sample timestamp per plant |

**Deliberately left on `PlantTelemetrySnapshot`** (not a Category A exception — this table is
itself already a Postgres read, not a live Huawei call): Dashboard's "This Month" and "Lifetime
Energy" figures. `DeviceTelemetry` only has today+yesterday bootstrapped (see the telemetry
foundation milestone) — there is no monthly/lifetime data to migrate yet. Moving these would mean
either fabricating a partial total or extending the importer, both explicitly out of scope
("Consumers only," "Do not change telemetry importer").

## 4. New query/computation layer (`lib/telemetry/*`)

Dashboard and Market never call `prisma.deviceTelemetry` directly — both compose these:

- **`lib/telemetry/queries.ts`** — pure Prisma reads: `getPlantTelemetryRange`,
  `getLatestTelemetry`, `getLatestMeterTelemetry`, `getLatestInverterTelemetry` (one row per
  inverter device, since a plant's inverters don't necessarily share exact timestamps — confirmed
  in production).
- **`lib/telemetry/energy-metrics.ts`** — derived computation, no Prisma, no Huawei:
  - `getPlantTelemetrySeries(plantId, start, end)` — a real, timestamp-aligned
    production/export/import series (kW). Production at a timestamp is the sum of every inverter
    that actually reported then; a missing device simply doesn't contribute (never assumed zero).
  - `computePlantEnergyMetrics` / `computeEnergyMetricsFromSeries` — numerically integrates power
    over time into kWh (a left-Riemann sum between consecutive real samples), and finds peak
    production. Gaps longer than 15 minutes are **not** integrated across — attributing the last
    known power to an hours-long gap would be estimating energy, not deriving it. `available:
    false` (all zeros) only when a window has zero samples — never a fabricated fallback.

## 5. Market chart overlay

`MarketPriceChart` gained an optional `telemetrySeries` prop: two additional lines (real
production, amber; real export, violet) on their own secondary kW axis (`yAxisId="power"`), each
using recharts' per-`<Line>` `data` override so they plot against their own real 5-minute
timestamps rather than being resampled onto the price series' (hourly/15-min) grid.
`connectNulls={false}` throughout — a missing sample ends the line, never interpolated. The overlay
is only ever passed for `data.isToday` (real telemetry only exists for "today so far," matching
"use the newest available telemetry"); browsing a past/future day via the toolbar shows the price
chart alone, not a fabricated or reused-from-today production line.

## 6. One deliberate scope decision: "Consumed Today" → "Imported Today"

The old Dashboard card showed "Consumed Today" (`dayUseEnergy` — the site's own energy use,
roughly production − export + import). `DeviceTelemetry` has no direct site-consumption figure, and
computing one would mean deriving a new value beyond what the milestone's explicit KPI list asked
for (produced/exported/imported only) — arguably adjacent to the kind of derived metric ADR-007
explicitly keeps out of the telemetry layer. The card was relabeled "Imported Today" and now shows
real grid-import energy instead, matching exactly what `DeviceTelemetry` can honestly provide.
Flagging this here rather than leaving it undocumented: it's a narrower metric than before, not a
silent substitution.

## 7. Validation

- `pnpm lint` / `turbo check-types` / `turbo build` — all pass cleanly (`apps/web` and the full
  workspace).
- **Local, against the real database** (local `DATABASE_URL` points at the same Postgres as
  production — confirmed in the telemetry foundation milestone): both pages rendered HTTP 200, no
  error digests, with real, non-fabricated values — e.g. `Today's production: 0 kWh` /
  `Peak production today: 0 kW at 00:20` (correctly zero — verified at ~01:00 local time, before
  sunrise) and `Imported energy today: 7.96 kWh` / `Current import: 3.96 kW` (real overnight
  standby draw). Chart legend confirmed rendering `Real production` / `Real export`.
- **Production, after deploy** (commit `f444011`, deployment `dpl_85HoDVkGKPceBa2uCWoDkH39cwcR`,
  `READY`, aliased to `app.voltessa.ai`): re-verified with a fresh temporary session — identical
  values (`15,301.72` / `208,952.94` / `7.96`), no error digests, chart legend present. Temporary
  session deleted after verification.

## 7a. Follow-up fix: chart appeared empty despite correct data (post-deploy)

After this milestone shipped, the Market chart's production/export overlay still looked empty.
Investigated methodically, in the order requested:

1. **Does `DeviceTelemetry` contain rows for the selected day?** Yes — 141 of the table's 1378
   total rows fall within `[today's local midnight, now)` for this plant.
2. **Does the selected day match the imported timestamps?** Yes — the window
   `[2026-07-18T21:00:00Z, now)` (Sofia local midnight) correctly captured the bootstrap's
   `2026-07-18T21:20:00Z`–`2026-07-19T01:10:00Z` rows; the remaining 1237 rows correctly fall
   before that window (yesterday's data, correctly excluded).
3. **Exact Prisma query?** `getPlantTelemetryRange({ plantId, timestamp: { gte: dayStart, lt: now
   } })` — no `devTypeId` filter at this layer, no resolution filter.
4. **Does it return rows?** Yes — 141, matching a hand-run equivalent query exactly.
5. **If rows exist, where are they discarded?** *Nowhere.* Confirmed end-to-end via the actual
   rendered page: the RSC payload contains real `telemetrySeries` entries
   (`productionKw`/`exportKw`/`importKw`), and a rendered-SVG inspection found the amber
   (`#fbbf24`) and violet (`#a78bfa`) line paths genuinely present in the DOM.
6. **Timezone handling?** Correct — Sofia local-midnight boundary computed correctly via the
   existing `localDayBoundsUtc` (reused from `market-price/timezone.ts`).
7. **Resolution filter?** Not a factor — only `FIVE_MIN` rows exist for this plant; no query
   anywhere filters on `resolution`.
8. **plantId/organizationId filtering?** Correct — zero `DeviceTelemetry` rows exist for any other
   plant, and the query is correctly scoped to this plant's `id`.

**Root cause**: not a data bug. `productionKw`/`exportKw` are genuinely `0` for the entire window
available so far (real, correct — it's nighttime, before sunrise). Recharts' default `"auto"`
Y-axis domain collapses to `[0, 0]` when every value is exactly `0`, which pins the flat line
exactly on the plot's edge (bottom, or — as first attempted — the top, if only the lower bound is
padded) where it visually blends with the axis stroke. **Fix**: give the power Y-axis's domain
explicit headroom on both sides regardless of the real data's range
(`domain={[(min) => Math.min(min - 0.5, -0.5), (max) => Math.max(max + 0.5, 1)]}` in
`MarketPriceChart.tsx`), so a flat-zero line always renders visibly separated from both plot
edges. Verified visually (Playwright screenshot): the line now renders as a clearly visible flat
segment spanning exactly the real data's time range, correctly stopping where data ends rather
than extending across the whole day.

Printed diagnostic values (from the investigation script, since deleted):
imported row count `1378`, queried row count (today's window) `141`, first timestamp
`2026-07-17T21:20:00.000Z`, last timestamp `2026-07-19T01:10:00.000Z`, first `activePower` `0`,
first `meterActivePower` `-1.83`.

## 8. What was explicitly not touched

- UI/visual design — only additive changes to existing components (two chart lines, five insight
  entries, one relabeled card), no layout redesign.
- No new features beyond what the milestone specified; no automation wiring.
- `lib/market-price/*` (ENTSO-E importer) — untouched.
- `lib/fusionsolar/import-device-telemetry.ts` / `bootstrap-device-telemetry.ts` (telemetry
  importer) — untouched.
- `lib/fusionsolar/export-control.ts` and the active export-control infrastructure — untouched,
  still uncalled from anywhere.
- Automation (`lib/automation/*`) — untouched, reads neither `PlantTelemetrySnapshot` nor
  `DeviceTelemetry`.

## 9. Known follow-up (not part of this milestone)

`PlantTelemetrySnapshot`-backed "This Month"/"Lifetime" will need either a real backfill into
`DeviceTelemetry` or an explicit decision to keep them on a separate rollup path once monthly/
lifetime aggregation is designed — tracked here, not solved here.
