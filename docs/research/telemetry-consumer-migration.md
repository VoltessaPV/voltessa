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

## 10. Telemetry Consumer Completion (follow-up milestone)

A second pass re-verified the entire pipeline end-to-end (Huawei → `DeviceTelemetry` → query layer
→ `energy-metrics` → page loader → React props → rendered component) and closed the remaining gaps
found. Nothing in the pipeline itself was broken — every gap was in the UI layer.

### Pipeline trace (fresh, this milestone)

| Stage | Result |
|---|---|
| Raw `DeviceTelemetry` (all time) | 1378 rows, `2026-07-17T21:20:00.000Z` → `2026-07-19T01:10:00.000Z` |
| Query layer (today's window, Sofia local midnight → now) | 141 rows, first `activePower` sample `0` at `2026-07-18T21:20:00.000Z`, first `meterActivePower` sample `-1.89` |
| `energy-metrics` layer | 47 timestamp-aligned series points, `producedKwh: 0`, `exportedKwh: 0`, `importedKwh: 7.96`, `peakProduction: 0 kW at 2026-07-18T21:20:00.000Z` |
| Page loader → props → rendered component | Verified via live local render (Playwright) — see below |

No stage discarded a value that existed in the stage before it. Every "0" reflects real nighttime
production, not a fabrication or a bug.

### Root causes found and fixed

1. **Chart missing the import series.** `MarketPriceChart` plotted `productionKw`/`exportKw` but
   never `importKw`, even though it was already flowing through `telemetrySeries` correctly. Added
   a third line (rose, `#fb7185`) using the same per-`<Line>` `data` override pattern as the other
   two — no query or data-layer change needed, the value was already there, just never rendered.
2. **Dashboard's "Telemetry available" badge was hardcoded.** It read `<span
   className="... bg-cyan-400" />Telemetry available` unconditionally, regardless of whether
   `metrics?.available` was actually `true` — a plant with zero `DeviceTelemetry` rows would still
   show a green "Telemetry available" badge. This directly violated "every card must show either a
   real value or an explicitly documented empty state." Fixed to branch on `metrics?.available`,
   showing "No telemetry for today yet" (slate dot) when false.
3. **Dashboard was missing two cards the milestone's checklist explicitly required**: "Peak
   Production" and "Current Power." Both were zero-new-infrastructure additions — Peak Production
   reads the same `PlantEnergyMetrics.peakProduction` already computed for Market's insights;
   Current Power reuses `getPlantCurrentPowerStatus` verbatim (the same Category A function
   Market's `production-data.ts` already calls), now also called per-plant on the Dashboard. Grid
   widened from 5 to 7 columns (`sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7`) to fit both.

### Verified, no fix needed

Timezone conversion, 5-minute alignment, device/meter filtering, query range construction, empty-
array handling, null filtering, and series mapping were all re-traced against fresh production data
this milestone and found correct — matching the prior milestone's findings, not a regression.

### Screenshots (local, Playwright)

- Market: chart now shows all three telemetry lines (amber production, violet export, rose import)
  alongside the ENTSO-E price line; legend lists all three; Insights panel shows all five
  telemetry-derived entries.
- Dashboard: "Telemetry available" (cyan) correctly shown for the plant with real telemetry;
  7-column grid shows Today/This Month/Lifetime/Exported Today/Imported Today/Peak Production/
  Current Power; "Current Power" correctly shows "— kW / FusionSolar data unavailable" in local
  dev, where the live gateway credentials are unavailable (the established, pre-existing sandbox
  limitation — not a regression from this change).

### Category A / Category B — unchanged from the prior milestone, now complete

**Still live Huawei reads (Category A)**: Market's Current Production/Export/Import, both pages'
Configured Mode, and the Dashboard's new Current Power card (reusing the identical function).

**Now DeviceTelemetry-only (Category B)**: everything historical on both pages — today's
production/export/import totals, peak production, the chart overlay, and telemetry-derived
insights. "This Month"/"Lifetime" remain on `PlantTelemetrySnapshot` (see §9 — unchanged, still
future work, not this milestone's scope).

### What was explicitly not touched (in addition to §8)

No importer changes, no schema changes, no revenue calculations — the Market Revenue card remains
the honest placeholder from the prior UI-polish milestone, untouched.

## 11. Telemetry Reliability & Market Chart Completion (follow-up milestone)

Investigated three observed symptoms against real production behavior — telemetry stopping ~04:00
local, production/export missing during daylight hours, and tooltip cross-series misalignment —
and fixed each at its root cause rather than its symptom.

### Root cause 1: telemetry stops updating after the manual bootstrap

Traced with a fresh diagnostic script (`diag-full-trace.cjs`, since deleted): the plant's latest
`DeviceTelemetry` row and the `bootstrapDeviceTelemetry` route's own `ingestedAt` were only ~4
minutes apart, and both were **446 minutes stale** at the time of measurement. `DeviceTelemetry` has
never been re-populated since the one-time manual bootstrap performed in the telemetry foundation
milestone — there is no periodic ingestion. This is a continuity gap, not a query, timezone, or
chart bug: `lib/telemetry/queries.ts` and `energy-metrics.ts` were re-checked and are unchanged from
the already-verified pipeline in §10 — they correctly return whatever rows actually exist, and the
newest row genuinely is from ~04:00 local.

**Attempted fix**: add `bootstrap-device-telemetry` to Vercel's native `crons` config
(`*/15 * * * *`). This **failed** — it broke the real "voltessa-web" production deployment outright.
Confirmed, not assumed: the failed GitHub commit status Vercel posted carried a shortlink
(`https://vercel.link/3Fpeeb1`) that 301-redirects directly to
`vercel.com/docs/cron-jobs/usage-and-pricing` — a plan-tier restriction on Vercel Cron Jobs. This is
almost certainly the same cause behind an earlier, unexplained revert from before this session's own
history (commits `6643255`/`853893d`). Reverted `vercel.json` immediately (commit `ea84f16`) to
restore deployability, and updated the route's doc comment with this confirmed finding.

**This is a genuine "manual cloud configuration required" stop condition**, not something the
codebase can resolve alone: continuous DeviceTelemetry ingestion needs either a Vercel plan upgrade
(to unlock native Cron Jobs) or an external scheduler (e.g. a GitHub Actions cron workflow calling
`bootstrap-device-telemetry` with `CRON_SECRET` as a repository secret). Both require a decision and
manual account setup outside what this milestone can perform. **Flagged here as the primary
remaining known limitation** — until resolved, the chart and all Category B cards will continue to
show data no fresher than the last manual bootstrap run, growing progressively more stale.

### Root cause 2: tooltip showed values from different timestamps across series

`MarketPriceChart` gave each `<Line>` its own `data` override (§5, §10) — the price line read the
15-minute ENTSO-E array, the telemetry lines read the 5-minute `DeviceTelemetry` array. Recharts'
shared-tooltip/shared-hover-index guarantee only holds when every `<Line>` under one `<LineChart>`
reads from the *same* array — with per-Line overrides of different lengths and resolutions, hovering
one index highlighted whatever happened to sit at that same array position in each series, not the
same real-world timestamp.

**Fix**: replaced the per-Line arrays with one unified, timestamp-keyed dataset (`UnifiedDatum[]`,
built by a new `buildUnifiedData()`) that merges every distinct timestamp from both the price and
telemetry series into a single sorted array, carrying `price`/`productionKw`/`exportKw`/`importKw`
per row. The day-ahead price is forward-filled across the 5-minute sub-rows *within its own real
15-minute interval* (a real block price genuinely applies for its whole interval — not fabrication);
telemetry values remain `null` on exact-timestamp mismatch only, never interpolated. `<LineChart
data={...}>` now supplies this single array to the chart, and no `<Line>` overrides it — this is what
makes recharts' shared hover index correct by construction. Verified visually: hovering shows one
timestamp (e.g. `03:15`) with price/production/import all reading from that same row; hovering a
time outside telemetry's range correctly shows price only, never a mismatched or fabricated
telemetry value.

### Root cause 3 / new requirement: engineering axes

The right-hand power axis previously auto-scaled per §7a's padding-function hack (built specifically
to make flat-zero lines visible). This milestone requires a real engineering scale instead: fixed
`domain={[0, installedCapacityKw]}` with `allowDataOverflow`, never negative, never derived from the
visible telemetry range. `installedCapacityKw` is read directly from `Plant.capacityKw` (added to the
`select` in `production-data.ts`, threaded through `ProductionPageData` → `market/page.tsx` →
`MarketPriceChart` props) — confirmed `= 200` for the one real plant ("Atlanta") — never hardcoded.
Left axis labelled "EUR/MWh", right axis labelled "kW", both via recharts' `<YAxis label>`.

### Time: five UTC-leakage sites fixed

Grepped for bare `.toLocaleString()` calls (no `timeZone` argument) across the affected files —
these render in the server's default timezone (UTC on Vercel), not Europe/Sofia. Found and fixed
five: one in `market-data.ts` (`marketStatus.lastUpdateLabel`) and four in `dashboard/page.tsx`
("Last telemetry", market's "Last successful update", and the two branches of `lastUpdatedLabel`).
Added a small `sofiaDateTimeLabel` helper to each file (following the existing convention of
duplicating simple formatting helpers rather than sharing a module) and replaced all five call
sites. Re-grepped afterward to confirm no bare calls remain.

### Verified, no fix needed

Re-traced the full pipeline (Huawei → `DeviceTelemetry` → query layer → `energy-metrics` → page
loader → props → chart) and confirmed timestamps match at every stage except where the ingestion
gap (root cause 1) makes the newest available row genuinely old — that staleness is real and
correctly reflected everywhere, not swallowed or fabricated at any layer.

### Validation

- `pnpm lint` / `turbo check-types` / `turbo build` — all pass cleanly for `apps/web`.
- **Local** (Playwright, temporary session): Market chart renders with both axis labels
  (`EUR/MWh` left, `kW` right), right axis fixed at `0`–`200`; hovering at `03:15` shows
  `122.31 EUR/MWh` / `0 kW production` / `1.84 kW import` all together; hovering at `22:00` (outside
  telemetry's range) shows only the price, confirming no fabricated telemetry values. Dashboard's
  "Last telemetry" correctly reads `19/07/2026, 04:10:00` (Sofia time, not UTC).
- **Production** (commit `6caf5a2`, deployment `dpl_G5Z8v7P3gtQZxU3JMQPotA3bvJ9S`, `READY`, aliased
  to `app.voltessa.ai`): re-verified with a fresh temporary session — identical rendering, identical
  tooltip behavior at `03:15`, zero console or network errors. Session and all screenshots deleted
  after verification.

### Remaining known limitations

1. **Continuous ingestion is still unresolved** (see root cause 1) — this is the primary open item.
   Requires a user decision: upgrade the Vercel plan to unlock native Cron Jobs, or wire an external
   scheduler (e.g. GitHub Actions) with `CRON_SECRET` as a secret. Until then, `DeviceTelemetry` (and
   therefore every Category B value on both pages) will keep drifting further from "now" — currently
   frozen at the last manual bootstrap's data (ending ~04:10 local on 2026-07-19).
2. Export series (`exportKw`) has no real non-zero data yet in the available window — it renders
   correctly (empty/flat, never fabricated) but hasn't been visually confirmed with a genuinely
   non-zero value, since the plant hasn't exported during any bootstrapped window so far.
3. §9's "This Month"/"Lifetime" gap (still on `PlantTelemetrySnapshot`) is unchanged, still future
   work.

## 12. Historical Backfill + Timeline Alignment (follow-up milestone)

Three goals: backfill seven complete local days plus today into `DeviceTelemetry`, backfill the
matching range into `MarketPrice`, and fix the Market chart's timeline (it was displaying the wrong
window entirely — not just missing data). All three verified against real production data.

### Goal 1 — DeviceTelemetry backfill

`bootstrapDeviceTelemetry`'s window was a rolling `now - 24h` instant, not anchored to any calendar
day. Added an optional `daysBack` parameter (`?days=N` on the route) and switched the window to
`daysBack` complete Europe/Sofia calendar days plus today, re-deriving each boundary's own true
local midnight (handles DST correctly, same technique `localDayBoundsUtc` already uses). `daysBack`
defaulting to `1` exactly reproduces the original "yesterday + today" shape for any existing caller.

Triggered against production (`app.voltessa.ai` — the only environment with real
`FUSIONSOLAR_GATEWAY_*` credentials; local dev has none) with `?days=7`:

- **First call**: `samplesFetched: 9292`, `samplesInserted: 7914`, `duplicatesSkipped: 1378`
  (exactly the row count from the original one-time bootstrap — confirming the unique constraint
  correctly recognized every previously-imported row), `unmatchedSamples: 0`, zero errors.
- **Second, identical call** (idempotency proof): `samplesFetched: 9292`, `samplesInserted: 0`,
  `duplicatesSkipped: 9292` — every single row skipped, nothing re-inserted.

Post-backfill database state (`DeviceTelemetry`, queried directly):

- **Oldest timestamp**: `2026-07-11T21:20:00.000Z` (= `2026-07-12T00:20` Sofia — one 5-minute
  interval past local midnight, i.e. the true start of the oldest complete day).
- **Newest timestamp**: `2026-07-19T09:40:00.000Z` (= `2026-07-19T12:40` Sofia — 7 minutes behind
  the moment the backfill finished, well within one telemetry interval).
- **Total rows**: 9292 (7914 new + 1378 pre-existing).
- **Samples per Sofia-local day**: 1237–1241 per complete day (2026-07-12 through 2026-07-18), 405
  for today-so-far (2026-07-19), 217 for the partial oldest boundary day (2026-07-11, correctly
  partial — that day is outside the requested 7-day range and only exists because the window's
  start instant falls a few hours into it in UTC terms).
- **Samples per device**: 5 devices (4 inverters, `devTypeId 1`; 1 meter, `devTypeId 47`). Three
  devices (two inverters + the meter) span the full range (2116 rows each, from
  `2026-07-11T21:20Z`); two inverters only start from `2026-07-12T02:25Z`/`02:30Z` (1474/1470 rows)
  — a real gap in what Huawei's history endpoint returned for those two specific inverters in the
  oldest partial day, not a bug in this importer (every other device/day pair is complete).
- **Duplicate `(deviceId, timestamp, resolution)` groups**: 0.

### Goal 2 — MarketPrice backfill

Added `backfillMarketPrices(daysBack)` to `refresh-market-prices.ts`, looping the existing
per-day `refreshMarketPrices()` (already idempotent via `upsert` on
`(biddingZone, timestamp, source)`) over `daysBack + 1` CET/CEST market days — the `+1` because
Bulgaria (Europe/Sofia) is always exactly one hour ahead of CET/CEST (both zones share the EU's DST
transition dates, just different standard offsets), so Sofia's local midnight always falls at23:00
CET/CEST the *previous* CET calendar day; backfilling `daysBack` complete Sofia days needs that one
extra, older CET day to cover the leading hour.

Triggered against production with `?days=7`: `daysRequested: 9`, `daysFetched: 9`, zero failures,
every one of the 9 CET days returning `expectedIntervals: 96`, `importedIntervals: 96`,
`missingIntervals: 0`, `isPartial: false`.

Verified directly against the database, per Sofia-local day (not per CET day — this is what the
Market chart actually displays):

| Sofia day | Intervals | Distinct hours | Duplicates |
|---|---|---|---|
| 2026-07-12 | 96 | 24 | 0 |
| 2026-07-13 | 96 | 24 | 0 |
| 2026-07-14 | 96 | 24 | 0 |
| 2026-07-15 | 96 | 24 | 0 |
| 2026-07-16 | 96 | 24 | 0 |
| 2026-07-17 | 96 | 24 | 0 |
| 2026-07-18 | 96 | 24 | 0 |
| 2026-07-19 (today) | 96 | 24 | 0 |

Every complete Sofia day has all 96 of its real 15-minute intervals (the plant's actual resolution
— "24 hourly prices" in the milestone's own wording is satisfied as 24 complete hours, each made up
of 4 real 15-minute intervals, not literally hourly rows, since ENTSO-E's real resolution for this
zone is 15 minutes, confirmed since the original ENTSO-E integration milestone). Today already has
its full 96 intervals too, since ENTSO-E publishes the whole day-ahead auction result before the day
begins. Zero duplicate `(biddingZone, timestamp, source)` groups database-wide.

### Goal 3 — Market chart timeline fix

**Root cause**: `market-data.ts`'s `getMarketPageData` and `lib/market-price/provider.ts`'s
`getDayAheadPrices` both windowed the *displayed* day using `ENTSOE_MARKET_TIMEZONE` (CET/CEST) —
the importer's own fetch-boundary convention, never meant to be the display boundary. Since
Bulgaria is one hour ahead of CET/CEST, this made the chart start at Sofia ~01:00 (CET midnight)
with an empty gap for Sofia's first hour, and cut off one hour before Sofia's real midnight.

**Fix**: `MarketPrice.timestamp` rows are real, absolute UTC instants — which CET calendar day
originally fetched them is irrelevant to querying them by any other correct time window. Added an
optional `timeZone` parameter to `getDayAheadPrices` (default unchanged, so Dashboard/Settings —
which only want "today" for simple stats — keep their existing CET-anchored behavior untouched), and
changed `market-data.ts` to pass `"Europe/Sofia"` for both its `todayDateStr`/toolbar-default
computation and the displayed `periodStart`/`periodEnd`. No importer change, no
`MarketPriceChart.tsx` change — the component already renders whatever full-day range
`buildSeries` hands it; once fed the correct Sofia bounds, it just works.

Verified with Playwright, both locally and in production:

- Chart's leftmost point is exactly Sofia `00:00`/`00:30` (no gap) and its rightmost tick is
  `23:45` (no bleed into the next day) — screenshotted and hand-checked against the X-axis ticks
  (`01:10` through `23:45` visible, price line starts flush at the left edge).
- Tooltip synchronization intact after the timeline change: hovering `00:30` showed
  `147.35 EUR/MWh` / `0 kW production` / `1.85 kW import` together (one real timestamp); hovering
  near the current moment (`12:45`) showed only price (telemetry's newest sample was `12:40`,
  correctly not fabricated past that point); hovering `23:30` showed `148.52 EUR/MWh` alone
  (telemetry naturally has no data that far ahead of "now").
- Left axis labelled `EUR/MWh`, right axis labelled `kW`, fixed at `0`–`200` (the plant's real
  `Plant.capacityKw`), matching the prior milestone's engineering-axis requirement — unchanged and
  re-verified, not re-implemented.
- With the Goal 1 backfill in place, the chart now also shows real, non-flat **export** data for
  the first time (a visible violet peak around 08:00–10:00, up to several dozen kW) — resolving
  §11's remaining limitation #2 ("export series has no real non-zero data yet").

### Same-local-day validation (proof, not assumption)

Printed together, all four referring to the same Sofia calendar day (`2026-07-19`):

- Current Sofia local time: `19/07/2026, 12:48:23`
- Newest `DeviceTelemetry` sample (Sofia): `19/07/2026, 12:40:00`
- Newest `MarketPrice` sample (Sofia): `19/07/2026, 23:45:00` (expected — day-ahead prices for the
  rest of today are already published)
- Newest plotted chart timestamp (Sofia): `19/07/2026, 23:45:00` (the price series defines the
  chart's full-day domain; telemetry is a subset of it, not a separate domain)

### Quality

`pnpm lint` / `turbo check-types` / `turbo build` all pass cleanly. Verified locally (dev server,
temporary session, Playwright) before pushing; verified again in production (commit `66482f3`,
deployment `dpl_ETsriNWzbHFgW4zMyqi6VzKyH94j`, `READY`, `app.voltessa.ai`) after deploy — zero
console errors, zero failed network requests, identical rendering and tooltip behavior to local.
All temporary diagnostic scripts, sessions, and screenshots deleted after use.

### What was explicitly not touched

No export-control changes, no UI redesign (only the underlying data window changed — the chart
component, its styling, and its axis logic are exactly as the prior milestone left them), no Revenue
Engine work, no changes to Dashboard's or Settings' own `getDayAheadPrices()` calls (both keep the
CET-anchored default).

### Remaining known limitations

1. Continuous ingestion (§11's primary open item — Vercel Cron Jobs plan-tier restriction) is
   unchanged by this milestone. This backfill was a one-time historical catch-up, triggered
   manually against production; `DeviceTelemetry` will again drift stale without either a Vercel
   plan upgrade or an external scheduler, exactly as flagged in §11.
2. The oldest boundary day (2026-07-11) is intentionally partial (217 rows) — it exists only
   because the backfill window's start instant falls a few hours into that day in UTC/device-history
   terms; it is outside the requested 7-complete-days range and is not meant to be complete.
3. Two of five devices are missing data for the first few hours of the oldest complete day
   (2026-07-12) — a real gap in what Huawei's history endpoint returned for those two inverters,
   not an importer bug (confirmed: every other device/day combination in the range is complete).

## 14. Mathematical Correctness (follow-up milestone)

Full diagnostic pass before any code changed, per the milestone's own instruction. Traced every
"telemetry is interpreted incorrectly" symptom to its exact root cause; no guessing. Three
architecture-level fixes and one permanent freshness fix.

### Diagnostic 1: historical telemetry missing — traced database → query → chart

`DeviceTelemetry` genuinely contained a full backfilled week (confirmed in §12) and
`getPlantTelemetryRange`/`getPlantTelemetrySeries` already accepted arbitrary `[start, end)`
windows — the query layer was never the problem. Traced upward instead:

- `production-data.ts`'s `getProductionPageData` computed its telemetry window as
  `localDayBoundsUtc(new Date(), plant.timezone)` to `new Date()` — **always today**, regardless
  of which day the Market toolbar had selected.
- `market/page.tsx` additionally passed `telemetrySeries={data.isToday ? production.telemetrySeries
  : undefined}` — hard-suppressing the chart's telemetry overlay outright for any non-today day.

Both were real code paths, not database gaps — once `DeviceTelemetry` held real historical data,
there was no route left that would ever display it for a past day. Fixed by making
`production-data.ts` compute the exact same `selectedDate`/`isToday`/Europe-Sofia-day-bounds logic
`market-data.ts` already used (duplicated on purpose — the two modules stay independent, see both
files' doc comments) and removing the `isToday` gate in `page.tsx` entirely. A past day now returns
its whole day (`dayEnd`, not `new Date()`); today still correctly stops at "now" (can't show future
telemetry).

### Diagnostic 2: freshness — traced Huawei → importer → database → query → page → chart

Checked every stage against real production state, not assumption:

| Stage | Result |
|---|---|
| Huawei / importer | `bootstrapDeviceTelemetry` is correct and idempotent (proven in §12) |
| Database | Newest row was `2026-07-19T09:40:00Z` (12:40 Sofia) — genuinely the newest real sample |
| Query / page / chart | All three correctly reflect exactly what's in the database — no bug found downstream |

**First (and only) stage where freshness was lost**: nothing between Huawei and the database ever
runs on a schedule. This is the same root cause §11 already identified (Vercel's native `crons`
config is blocked on this plan tier) — re-confirmed, not re-guessed: `newestDeviceTelemetry` was 43
minutes behind wall-clock time at the moment of this check, consistent with the bootstrap only ever
running when manually triggered.

**Fix, not another workaround**: added `.github/workflows/telemetry-ingest.yml`, a GitHub Actions
schedule (`*/15 * * * *`) that calls the already-idempotent `bootstrap-device-telemetry` route with
`CRON_SECRET` (set as a repository secret via `gh secret set`) as the bearer token — no Vercel plan
change needed. Verified by manually dispatching the workflow: HTTP 200, `samplesInserted: 77` (real
new rows), `duplicatesSkipped: 1861`. Re-checked the database immediately after: newest sample moved
to `2026-07-19T14:00:00Z` with wall-clock at `14:05:37` — a **6-minute** gap, down from 43. This is a
permanent fix, not a one-time backfill: the schedule keeps running independently of this session.

### Diagnostic 3: meter counter fields — proven empirically against real data, not documentation

`DeviceTelemetry.activeEnergy`/`.reverseActiveEnergy` (Huawei `active_cap`/`reverse_active_cap`)
were assumed, in the schema's original doc comments, to mean "forward/import" and "reverse/export"
respectively — a plausible-sounding reading of Huawei's field names that was never checked against
real data. Queried every real meter row for this plant (2116 samples, 8 days) and checked:

1. **Monotonicity**: both counters showed **zero decreases** across the entire range — exactly how
   a real cumulative meter counter behaves, and instantaneous power never does.
2. **Sign correlation**: `activeEnergy` increases almost exclusively while `meterActivePower > 0`;
   `reverseActiveEnergy` increases almost exclusively while `meterActivePower < 0`.
3. **Magnitude cross-check**: a 25-minute real daytime window (power rising 39 → 60 kW) moved
   `activeEnergy` by +19.38 kWh; a left-Riemann integration of that same window's power gives
   19.57 kWh — within 1%.

Conclusion, opposite of the original assumption: **`activeEnergy` is the real cumulative EXPORT
counter; `reverseActiveEnergy` is the real cumulative IMPORT counter.** This matches the
already-correct power-sign convention elsewhere in the codebase (`exportKw = max(power, 0)`) — only
the *counter field labels* were backwards, not the power-sign logic. `prisma/schema.prisma`'s doc
comments corrected to state this, with the investigation referenced inline.

Since real counters exist, exported/imported energy is now derived from **counter differences**
(`getPlantSettlementEnergySeries`/`sumSettlementEnergy` in `lib/telemetry/energy-metrics.ts`) instead
of integrating instantaneous power — strictly more accurate, exactly what reading a physical meter
twice would give. `computePlantEnergyMetrics`'s public return shape is unchanged (both Dashboard and
Market still get `exportedKwh`/`importedKwh` the same way), only its internal correctness changed.
`producedKwh`/`peakProduction` still come from power integration, since no cumulative production
counter exists in this table for inverters (Huawei's `day_cap`/`total_cap` live only in
`rawPayload`) — documented as explicit future work, not solved here.

### Diagnostic 4 / architecture correction: Market shows energy, Dashboard shows power

Re-examined the Market chart's purpose: it represents financial settlement, and money is earned
from *energy* traded at a price, not from instantaneous power. `MarketPriceChart.tsx` previously
plotted production/export/import **power** (kW) alongside price — the same live/telemetry
distinction Dashboard already correctly makes, just misapplied to the wrong page. Removed the three
power lines entirely; the chart now renders exactly price (EUR/MWh, left axis) and exported
**energy** (kWh per real 15-minute settlement interval, right axis, violet bars) — nothing else.
Dashboard is untouched and keeps all three power widgets, since instantaneous power is genuinely
what an operational overview needs.

The right (energy) axis is fixed at `[0, installedCapacityKw * 0.25]` — one settlement interval's
worth of energy at full installed capacity, read from `Plant.capacityKw`, never hardcoded, never
auto-scaled from the visible bars.

### Diagnostic 4b: price-curve distortion — root cause and fix (turned out to be the same fix)

The previous milestone's unified chart dataset forward-filled each 15-minute price value across the
denser 5-minute telemetry sub-rows so every row had *some* price to show in a shared tooltip. Visual
side effect: a genuinely smooth price line rendered with visible steps wherever telemetry existed,
because recharts drew through several repeated-value points before jumping, instead of interpolating
directly between two distinct real price points.

Once exported energy moved to 15-minute settlement intervals (Diagnostic 4), it landed on **the
exact same grid** the price series already uses (both built from the same `[dayStart, dayEnd)`
Europe/Sofia bounds, same 15-minute step). The unified dataset (`buildUnifiedData` in
`MarketPriceChart.tsx`) is now a plain 1:1 zip by timestamp — no forward-filling, no resampling.
The price line is therefore pixel-for-pixel what it would be rendered alone again, and the tooltip
stays perfectly synchronized (same row, same timestamp, by construction) with no distortion
trade-off needed.

### Diagnostic 5: settlement interval alignment

Verified directly: `getPlantSettlementEnergySeries` is called with the identical `dayStart`/
`seriesEnd` bounds `market-data.ts` computes for the price series, and both step in fixed
15-minute (`SETTLEMENT_INTERVAL_MINUTES`) increments from the same Europe/Sofia day start. Exported
and imported energy, telemetry aggregation, and price all therefore share exactly the same 96 (or
fewer, for today-so-far) interval boundaries per day — confirmed by the merge requiring no
resampling (Diagnostic 4b) and by every rendered tooltip showing one real timestamp shared across
both series.

### Validation — three real days, mathematically consistent

Verified locally and in production (identical results), for today (2026-07-19), yesterday
(2026-07-18), and two days ago (2026-07-17):

- **Today**: chart bars span 06:15–09:45 (the day's real export window so far); tooltip at 06:45
  shows `106.08 EUR/MWh` + `2.97 kWh exported`, same timestamp. Insights: `Exported energy: 84.69
  kWh` / `Imported energy: 13.86 kWh` — identical to Dashboard's own figures for the same plant/day
  (both now read the same corrected `computePlantEnergyMetrics`).
- **Yesterday**: full day of bars (00:00–23:45, not just "up to now") — the direct fix for
  Diagnostic 1. Tooltip at 06:45 shows `123.49 EUR/MWh` + `1.37 kWh exported`. Insights:
  `Exported energy: 500.46 kWh` / `Imported energy: 21.55 kWh`.
- **Two days ago**: also a full day of bars, a visibly different real export pattern (multiple
  peaks across the day). Tooltip at 06:45 shows `158.7 EUR/MWh` + `1.52 kWh exported`. Insights:
  `Exported energy: 384.1 kWh` / `Imported energy: 200.45 kWh`.

Zero console or network errors on any of the three days, locally or in production. Right axis
stayed fixed at `0`–`50 kWh` across all three days regardless of each day's different price range
(left axis, unaffected, auto-scaled per day as before) — confirming the energy axis is genuinely
capacity-derived, not auto-scaled from the visible bars.

### What was explicitly not touched

No changes to `lib/fusionsolar/import-device-telemetry.ts` (the importer itself), no changes to
`lib/market-price/*` (ENTSO-E integration), no export-control changes, no Revenue Engine work, no
UI redesign beyond the Market chart's own data series (layout/styling otherwise unchanged).

### Remaining known limitations

1. `producedKwh`/`peakProduction` still use power integration (no cumulative production counter
   exists for inverters in this table) — unchanged, documented future work.
2. Two of five devices are missing their first few hours of the oldest complete backfilled day
   (§12, unchanged, a real Huawei data gap, not a bug here).
3. §9's "This Month"/"Lifetime" gap (still on `PlantTelemetrySnapshot`) is unchanged.
