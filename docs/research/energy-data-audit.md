# Energy Data Audit — Dashboard & Market

Status: **Investigated (§1-§6.4), then implemented and verified in production (§6.5, §8) by the
Telemetry Architecture Finalization milestone.** Every number in the original investigation was
traced through the actual current code (not memory) and cross-checked against live Huawei API
responses and real stored `DeviceTelemetry`/`rawPayload` rows on 2026-07-20, ~11:35 UTC. §8 records
what was then built, deployed, and confirmed working against production.

## 1. Method

For every displayed value: UI component → data-layer function → Prisma column (if any) → Huawei API
field. Three real, independent checks were run live against production to validate the trace, not
assume it:

| Check | Our value (this instant) | Huawei's own value (same/nearby instant) | Source |
|---|---|---|---|
| Produced Today | `469.42` kWh (power integration) | `659.17` kWh (Σ inverter `day_cap`) / `669.8` kWh (station `day_power`) | `/api/diag/fusionsolar-device-realtime`, `/api/diag/fusionsolar-plant-realtime` |
| Exported Today | `173.24` kWh (meter counter diff) | `177.82` kWh (station `day_on_grid_energy`) | same |
| Consumed Today | *(derived from the above, inherits the Produced error)* | `632.06` kWh (station `day_use_energy`) | same |
| Revenue Today | Voltessa-only (real EUR/MWh × real kWh) | `day_income` / `total_income` = **`0`** (not configured on Huawei's side) | same |

**Conclusion up front:** Huawei already computes and exposes Produced/Exported/Imported/Consumed
Today at the **station level** (`getStationRealKpi`) with a single call — no local reconstruction
needed for any of the four. Only **Revenue Today** has no Huawei equivalent (Huawei's own income
fields are zero/unconfigured for this plant) and must remain Voltessa-derived.

## 2. Field-by-field matrix

Legend: **Direct** = Huawei returns this value already computed, no math on our side beyond unit
handling. **Derived** = computed by Voltessa from more than one real Huawei-sourced value via a
documented identity (no fabrication). **Reconstructed** = computed by Voltessa by numerically
approximating a quantity Huawei *also* separately provides as a direct counter/total — this is the
category the user asked to eliminate. **Estimated** = not currently used anywhere in this app.

### Daily totals (Dashboard KPI row / Market top cards)

| UI field | Exact source chain | Exact Huawei field | Category | Huawei already provides it? |
|---|---|---|---|---|
| **Produced Today** | `dashboard-data.ts` → `computeEnergyMetricsFromSeries()` → `integrateKwh()` (`lib/telemetry/energy-metrics.ts`) integrating `DeviceTelemetry.activePower` (devTypeId 1) samples over the day | Per-inverter `active_power` (`getDevFiveMinutes`/`getDevRealKpi`), numerically integrated by us | **Reconstructed** | **Yes** — `day_power` (station, `getStationRealKpi`) or Σ `day_cap` (per inverter, same endpoints already called) |
| **Consumed Today** | `dashboard-data.ts`: `producedKwh + importedKwh - exportedKwh` (arithmetic identity, inherits Produced Today's error) | Not read from any single field — pure arithmetic on our own other values | **Reconstructed** (via its reconstructed input) | **Yes** — `day_use_energy` (station, `getStationRealKpi`) |
| **Exported Today** | `production-data.ts` → `getPlantSettlementEnergySeries()`/`sumSettlementEnergy()` (`energy-metrics.ts`) — counter **difference** of `DeviceTelemetry.activeEnergy` (meter, devTypeId 47) across the day | Meter `active_cap` (`getDevFiveMinutes`), counter difference — **not** integration | **Derived** (real counter diff, already validated: `173.24` vs Huawei's `177.82`, gap fully explained by query-timing) | Yes, also — `day_on_grid_energy` (station) — but our own derivation already agrees closely, so this is lower priority than Produced/Consumed |
| **Imported Today** | Same as Exported, using `DeviceTelemetry.reverseActiveEnergy` | Meter `reverse_active_cap`, counter difference | **Derived** (same quality as Exported) | Station KPI has no separate "day import" field observed; ours is already a real counter diff, not integration |
| **Revenue Today** | `market/page.tsx` & `dashboard-data.ts` → `computeExportRevenue()` (`lib/market-price/revenue.ts`): Σ (settlement-interval exported kWh × that interval's real ENTSO-E price) | **None.** Not a Huawei field at all — ENTSO-E price is not something Huawei knows | **Derived** (genuinely Voltessa's own domain, no Huawei substitute exists or should exist) | **No** — `day_income`/`total_income` exist but are `0`/unconfigured for this plant, and even if populated would reflect Huawei's own assumed tariff, not the real Bulgarian day-ahead market price. Not a valid substitute regardless of configuration. |

### Real-time power (System Overview / per-inverter list)

| UI field | Exact source chain | Exact Huawei field | Category | Huawei already provides it? |
|---|---|---|---|---|
| **Current PV power** | `production-data.ts` → `getPlantCurrentPowerStatus()` (`get-plant-power-status.ts`) → Σ per-inverter `active_power` via `getDevRealKpi`, devTypeId 1 | `active_power` per inverter (already kW for this device type — confirmed, see prior milestone) | **Direct** (summed across devices, not otherwise transformed) | Yes — already used correctly |
| **Current Grid power (import/export)** | Same function → meter `active_power` via `getDevRealKpi`, devTypeId 47, ÷1000, sign-split | `active_power` (meter, watts) | **Direct** (unit-converted, sign-split into two named readings) | Yes — already used correctly |
| **Current Consumption ("Home") power** | `lib/telemetry/energy-flow.ts`'s `deriveEnergyFlow()`: `PV ± Grid` | **None found.** No dedicated "load"/consumption power field observed in any `getDevRealKpi`/`getStationRealKpi` response captured during this or prior investigations | **Derived** (no independent meter/field exists for this quantity anywhere in the integration) | No — must stay derived unless a dedicated load meter is added to the plant/account in future |
| **Per-inverter active power** (Inverters list) | `get-plant-inverter-status.ts` → `getDevRealKpi`, devTypeId 1, per device | `active_power` per device (kW, already correct unit) | **Direct** | Yes — already used correctly |

### Chart series (Dashboard's Live Energy chart)

| Line | Exact source chain | Exact Huawei field | Category |
|---|---|---|---|
| **PV Production** | `dashboard-data.ts` → per-`DeviceTelemetry` sample (devTypeId 1) `activePower`, one point per real 5-min sample — **no integration in the chart itself**, just plotted as-is | `active_power` (historical, `getDevFiveMinutes`) | **Direct** (per-point; only the separate *Produced Today* KPI integrates this series — the chart line itself does not reconstruct anything) |
| **Consumption** | `deriveEnergyFlow()` per point (`PV ± Grid`), or `null` if inconsistent | None | **Derived** per point |
| **Grid Import** / **Grid Export** | Per-`DeviceTelemetry` sample (devTypeId 47) `meterActivePower`, sign-split | `active_power` (meter, historical) | **Direct** per point |

### Market's own chart (Price & Export)

| Series | Exact source chain | Exact Huawei field | Category |
|---|---|---|---|
| Electricity price | ENTSO-E only, `dbMarketPriceProvider` → `MarketPrice` table | N/A (not Huawei) | Direct from ENTSO-E |
| Exported energy (violet bars) | Same `getPlantSettlementEnergySeries()` as "Exported Today" — meter counter diff, 15-min intervals | Meter `active_cap` | **Derived** (real counter diff, already validated above) |

## 3. Dependency graph

```
Dashboard "Produced Today"
  -> computeEnergyMetricsFromSeries() [energy-metrics.ts]
    -> integrateKwh() over DeviceTelemetry.activePower (devTypeId 1)
      -> Huawei active_power (getDevFiveMinutes)          <-- RECONSTRUCTED
                                                                (Huawei already has: day_power / day_cap)

Dashboard "Consumed Today"
  -> producedKwh + importedKwh - exportedKwh              <-- RECONSTRUCTED (via Produced Today)
                                                                (Huawei already has: day_use_energy)

Dashboard/Market "Exported Today" / chart bars
  -> sumSettlementEnergy() / getPlantSettlementEnergySeries() [energy-metrics.ts]
    -> counter diff of DeviceTelemetry.activeEnergy (devTypeId 47)
      -> Huawei active_cap (getDevFiveMinutes)             <-- DERIVED, already close to Huawei
                                                                (Huawei also has: day_on_grid_energy)

Dashboard "Imported Today"
  -> counter diff of DeviceTelemetry.reverseActiveEnergy
      -> Huawei reverse_active_cap                         <-- DERIVED, same quality as Exported

Dashboard/Market "Revenue Today"
  -> computeExportRevenue() [lib/market-price/revenue.ts]
    -> exportedKwh (see above, already derived)
    x ENTSO-E MarketPrice (independent, non-Huawei)         <-- DERIVED, no Huawei equivalent exists

System Overview "PV" / "Grid" (live)
  -> getPlantCurrentPowerStatus() [get-plant-power-status.ts]
    -> Huawei active_power (getDevRealKpi), inverters + meter  <-- DIRECT

System Overview "Home" (live)
  -> deriveEnergyFlow(PV, Export, Import)                   <-- DERIVED, no Huawei field exists

Inverters list (per device)
  -> getPlantInverterStatuses() [get-plant-inverter-status.ts]
    -> Huawei active_power (getDevRealKpi), per device        <-- DIRECT

Live Energy chart lines (PV / Import / Export)
  -> raw DeviceTelemetry.activePower / meterActivePower per sample <-- DIRECT (per point)
Live Energy chart line (Consumption)
  -> deriveEnergyFlow() per point                               <-- DERIVED
```

## 4. Where we currently calculate something Huawei already returns

Ranked by how directly replaceable each one is:

1. **Produced Today** — highest priority. Huawei's `getStationRealKpi.day_power` (station-level,
   already called by the dormant `syncFusionSolarPlantTelemetry`/`PlantTelemetrySnapshot` pipeline)
   or Σ per-inverter `day_cap` (already fetched into `rawPayload` on every historical row, unused)
   would replace `integrateKwh()` entirely for this value. Confirmed ~30% more accurate than our
   current integration, live.
2. **Consumed Today** — same priority, same fix. `day_use_energy` (station level) replaces the
   `produced + imported - exported` arithmetic entirely, and stops inheriting Produced Today's error.
3. **Exported Today / Imported Today** — lower priority. Our counter-diff derivation is already close
   to Huawei's own `day_on_grid_energy` (within ~2.6% at matched instants, fully explained by query
   timing) — this is *not* the same class of problem as Produced/Consumed. Worth noting, not urgent.
4. **Revenue Today** — not replaceable. Huawei's `day_income`/`total_income` are `0` for this plant
   (unconfigured) and, even if populated, would reflect Huawei's own assumed tariff rather than the
   real Bulgarian day-ahead market price this figure is specifically supposed to represent. This must
   stay a Voltessa calculation.
5. **Current Consumption ("Home") power** — not replaceable today. No dedicated load-power field has
   been observed in any Huawei response captured in this or prior investigations. Stays derived
   unless a dedicated load meter is added to the account/plant in the future.

## 5. Existing, currently-dormant infrastructure relevant to a fix

- `lib/fusionsolar/plant-data.ts`'s `getFusionSolarPlantRealTimeData()` already calls
  `/thirdData/getStationRealKpi` and is fully working (exercised live for this audit).
- `lib/fusionsolar/sync-plant-telemetry.ts`'s `syncFusionSolarPlantTelemetry()` already parses
  `day_power`/`day_on_grid_energy`/`day_use_energy`/`day_income`/`total_power`/`month_power` into
  `PlantTelemetrySnapshot` — but this pipeline is not currently scheduled anywhere (superseded by the
  `DeviceTelemetry`/`bootstrap-device-telemetry` path for the "Today" figures Dashboard/Market
  actually show today), so any current `PlantTelemetrySnapshot` rows are stale, not continuously
  fresh.
- Per-inverter `day_cap`/`total_cap` are already present in every already-imported `DeviceTelemetry`
  row's `rawPayload` (confirmed: not just live, but also in stored historical rows) — nothing needs
  to be re-fetched from Huawei to use them; they were simply never read out of `rawPayload` into a
  typed column or calculation (ADR-007 flagged this as explicit, unstarted future work).

## 6. Follow-up: side-by-side comparison + root cause + migration plan

Requested as a second pass after the initial audit above. Still investigation only — no code
changed. All values below captured within a ~90-second window on 2026-07-20 (Huawei at
`11:47:40Z`/`11:49:39Z`, Voltessa reproduction at `11:48:13Z`/`11:49:04Z`) — at ~140 kW instantaneous
power, 90 seconds of drift accounts for at most ~3.5 kWh, far below the gaps found, so timing is not
a meaningful confound.

### 6.1 Side-by-side table

| KPI | Huawei (`getStationRealKpi`) | Voltessa (current) | Abs. diff | % diff (vs Huawei) | Current Voltessa source | Huawei exposes it directly? |
|---|---|---|---|---|---|---|
| **Produced Today** | `682.64` kWh (`day_power`) | `488.21` kWh | `194.43` kWh | **28.5%** | `integrateKwh()` over `DeviceTelemetry.activePower` | **Yes** — `day_power` |
| **Consumed Today** | `638.11` kWh (`day_use_energy`) | `451.81` kWh | `186.30` kWh | **29.2%** | `produced + imported - exported` (inherits Produced's error) | **Yes** — `day_use_energy` |
| **Exported Today** | `184.61` kWh (`day_on_grid_energy`) | `177.82` kWh | `6.79` kWh | **3.7%** | Meter `activeEnergy` counter diff | Yes, but ours is already close |
| **Imported Today** | `140.08` kWh (*implied* — see 6.3) | `141.42` kWh | `1.34` kWh | **1.0%** | Meter `reverseActiveEnergy` counter diff | Not as its own field — see 6.3 |
| **Revenue Today** | `0` (`day_income`, unconfigured) | `11.46` EUR | N/A | N/A | `computeExportRevenue()` (real kWh × real ENTSO-E price) | **No** |

### 6.2 Root cause of each discrepancy — traced, not assumed

**Produced Today / Consumed Today (28-29%): the integration method itself, confirmed structural.**

Independently cross-checked per inverter, at the exact same moment, two ways:

- Station-level `day_power` (`682.64`) exactly equals the sum of the four inverters' own `day_cap`
  counters (`146.39 + 178.10 + 174.91 + 183.24 = 682.64`, to the cent) — proving Huawei's two
  endpoints are internally consistent with each other (not two independently-fallible numbers that
  coincidentally agree).
- Our own `integrateKwh()`, run against the identical `DeviceTelemetry.activePower` samples for the
  same window, gives `488.21` — a `28.5%` shortfall that reproduces almost exactly what was found
  ~13 minutes earlier in the previous investigation (`469.42` vs `659.17`, `28.8%` at that time) —
  i.e. the gap is stable and structural, not a one-off sampling artifact.

Mechanism: `integrateKwh()` is a left-Riemann sum — it holds each 5-minute sample's power level
constant until the next sample. On a day with real intra-interval variability (confirmed visually:
today's Live Energy chart shows sharp, frequent spikes/dips consistent with passing cloud cover),
this systematically misses energy: a short peak that rises and falls between two 5-minute samples
contributes nothing to the sum, and a sample caught during a trough undercounts the whole interval
it represents. `day_cap` is a true hardware-accumulated counter inside the inverter — it does not
have this blind spot by construction. This is not a bug in arithmetic; it is a category error
(approximating a counter with a coarse numerical integration when the real counter was available
the entire time, sitting unused in `rawPayload`).

Sample-count gaps (raised in the previous investigation) were re-confirmed **not** to be a
meaningful contributor: two of four inverters are missing their first ~5 hours of samples today, but
that window is before sunrise (near-zero real production regardless), and those same two inverters
show a *smaller* relative shortfall than the two with full sample coverage — the opposite of what a
gap-driven story would predict. Timezone/day-boundary logic was re-confirmed correct (`day_cap`
resets to exactly `0` at `21:00 UTC` = Sofia midnight, matching our own day-boundary computation
exactly).

**Exported Today / Imported Today (1-4%): already good, small residual is not methodology error.**

Both are already derived from real meter counter differences (`activeEnergy`/`reverseActiveEnergy`),
never integration — the same category of calculation Huawei's own `day_cap` is. The small residual
gap (3.7% / 1.0%) is consistent with normal counter-reading/query-timing noise at this granularity,
not a structural flaw. This is direct evidence for what "done right" looks like in this codebase:
Exported/Imported already follow the exact pattern Produced/Consumed should follow.

**Revenue Today: no discrepancy to explain — Huawei provides no comparable figure.**

`day_income`/`total_income` are `0` for this plant (unconfigured on Huawei's side). Even if Huawei
populated these, they would reflect whatever flat tariff Huawei's own configuration assumes, not the
real Bulgarian day-ahead market price this figure specifically exists to capture. Not a candidate for
replacement under any configuration.

### 6.3 Why "Imported Today" has no direct Huawei field — worked from Huawei's own numbers

`getStationRealKpi` does not return a `day_import_energy`-style field. But Huawei's own three
station-level numbers obey the same conservation identity this codebase already uses internally
(`energy-metrics.ts`): `day_use_energy = day_power + day_import - day_on_grid_energy`. Solving with
Huawei's own captured numbers: `day_import = 638.11 - 682.64 + 184.61 = 140.08` kWh — an *implied*
Huawei-consistent import figure, not a directly-exposed one. Voltessa's own meter-counter-based
`141.42` kWh agrees with this implied figure within `1.0%`, reinforcing (independently of the
Exported Today check) that the meter-counter-diff approach is already sound and does not need
`day_power`-style replacement.

### 6.4 Migration plan

| KPI | Recommendation | Why |
|---|---|---|
| **Produced Today** | **Replace** with `getStationRealKpi.day_power` (or, if per-device breakdown is ever needed, Σ per-inverter `day_cap`) | Huawei's own hardware counter; ours is a structurally lossy approximation of the same quantity, confirmed ~28-29% off, twice, independently |
| **Consumed Today** | **Replace** with `getStationRealKpi.day_use_energy` | Same reasoning — also removes its dependency on Produced Today's error |
| **Exported Today** | **Keep** current meter-counter-diff calculation | Already within ~4% of Huawei's own figure; already the "counter, not integration" pattern this audit recommends elsewhere |
| **Imported Today** | **Keep** current meter-counter-diff calculation | Same — within ~1% of Huawei's own implied figure; no direct Huawei field exists to replace it with anyway |
| **Revenue Today** | **Keep** — must remain Voltessa-derived | No viable Huawei substitute exists or would be meaningful even if configured |
| Current PV / Grid power (real-time) | No change | Already direct from Huawei, already confirmed matching |
| Current Consumption ("Home") power (real-time) | No change | No Huawei field exists for this; must stay derived |

Practical note for whoever implements this: `getStationRealKpi` is a single call per station (already
implemented in `lib/fusionsolar/plant-data.ts`, currently only wired into the dormant
`PlantTelemetrySnapshot` pipeline) — replacing Produced/Consumed Today would mean calling it fresh
wherever "Today" figures are computed (Dashboard, Market, revenue), rather than reviving the stale
snapshot table as-is. Not decided or scoped here, per this milestone's investigation-only mandate.

### 6.5 Implemented (Telemetry Architecture Finalization milestone, ADR-010)

Every recommendation in §6.4's table above was implemented exactly as written:

- New `PlantDailyKpi` table, written every 5-minute Scaleway ingestion cycle by
  `lib/fusionsolar/import-plant-daily-kpi.ts` (called from `bootstrap-device-telemetry.ts`, not a
  new scheduler), read by `lib/telemetry/plant-daily-kpi.ts`'s `getPlantDailyKpi` — the one place
  Dashboard (and any future Market/Automation/Reporting consumer) reads Produced/Consumed Today
  from. `dashboard-data.ts` no longer calls `computeEnergyMetricsFromSeries` for these two KPIs.
- Exported/Imported Today, Revenue Today, and every real-time value: untouched, exactly as §6.4
  recommended.
- The dormant `PlantTelemetrySnapshot` pipeline (code, not table/data) was removed rather than
  revived, since reviving it would have meant two code paths calling `getStationRealKpi` for the
  same purpose. See ADR-010 for the full decision and consequences.

## 7. What this audit deliberately did not do

This section describes the state as of the original investigation-only audit (§1-§6.4) — no code
was changed, no unit conversions were touched, no backfill was run, no inconsistency was "fixed."
§6.5 above records what the *follow-up implementation milestone* (ADR-010) then did, once explicitly
authorized. See docs/research convention (`docs/research/fusionsolar-active-power-control.md` §13
for the related prior investigation this one builds on, and ADR-007 in
`docs/ARCHITECT_DECISIONS.md` for why `DeviceTelemetry` was designed as a raw producer table with
`rawPayload` preserved unmodified — this is exactly what made re-deriving today's findings from
already-stored data possible without a single new Huawei API call).

## 8. Telemetry Architecture Finalization — implementation & production verification report

Full implementation of §6.4/§6.5's plan, executed end to end: schema, ingestion, domain read layer,
Dashboard wiring, validation, deploy, and production verification. See ADR-010
(`docs/ARCHITECT_DECISIONS.md`) for the architectural decision this records; this section is the
production evidence.

### 8.1 What changed

- **New `PlantDailyKpi` table** (`prisma/schema.prisma`), organization-scoped (ADR-002), unique on
  `(plantId, localDate)`. Typed columns for exactly the Huawei fields needed
  (`pvYieldKwh`/`day_power`, `consumptionKwh`/`day_use_energy`, `exportedEnergyKwh`/
  `day_on_grid_energy`, reference-only); the complete `dataItemMap` (including `total_income`/
  `total_power`/`day_income`/`real_health_state`/`month_power`) preserved unmodified in `rawPayload`,
  matching `DeviceTelemetry`'s own discipline — no calculated/derived field was invented.
- **`lib/fusionsolar/import-plant-daily-kpi.ts`** — the one code path in this codebase that calls
  `getStationRealKpi`. Upserts per plant per local (Europe/Sofia) day; never writes a row when
  `day_power`/`day_use_energy` are absent (an absent row reads back as `available: false`, never a
  fabricated `0`).
- **`lib/fusionsolar/bootstrap-device-telemetry.ts`** extended to call the above every cycle,
  alongside the existing `DeviceTelemetry` import — same route, same Scaleway timer, no second
  scheduler.
- **`lib/telemetry/plant-daily-kpi.ts`**'s `getPlantDailyKpi` — the one shared read function;
  `dashboard-data.ts` now calls this instead of integrating `chartSeriesRaw` for Produced/Consumed
  Today. Market was checked and does not currently display these two KPIs at all, so there was no
  second call site to migrate.
- **Removed**: `syncFusionSolarPlantTelemetry`, `ingestFusionSolarPlantTelemetry`, and the two routes
  that called them (`/api/internal/fusionsolar/ingest-plant-telemetry`,
  `/api/diag/fusionsolar-sync-plant-telemetry`) — this pipeline called the same Huawei endpoint
  independently of the new one, which would have meant two code paths calling `getStationRealKpi`.
  `PlantTelemetrySnapshot` (the table, and its 906 already-stored historical rows) was deliberately
  **kept**, not dropped — `prisma db push` reported it would require `--accept-data-loss`, and
  destroying 906 rows of production data was judged out of proportion to this milestone, per direct
  confirmation. It is now dead, unread, unwritten schema — a dedicated future cleanup migration can
  drop it once `PlantDailyKpi` has run in production for a while.

### 8.2 Validation

- `pnpm lint`, `turbo check-types`, `turbo build` (full, unscoped — not `--filter=web`): all pass.
  `apps/api`'s Jest suite: 1/1 passing (unaffected by this change, run anyway per Definition of
  Done).
- `prisma db push`: additive only (confirmed via the `--accept-data-loss` requirement above,
  resolved by keeping `PlantTelemetrySnapshot` rather than by accepting data loss) — the second,
  final push reported "Your database is now in sync" with no warnings.
- `git diff`/`git status` before commit: only the files this milestone touched — no unrelated
  formatting or drive-by changes.

### 8.3 Production verification (2026-07-20, ~12:15-12:17 UTC)

- Commit `9ac7e80` pushed to `main`; GitHub Actions CI (`lint`, `check-types`, `build`) passed;
  Vercel production deployment `dpl_3SmbRqsaGzy7VPyBaQiZ9u6659a4` for that exact commit is `READY`.
- Manually triggered `voltessa-telemetry-ingestion.service` on the Scaleway VM (the same unit
  ADR-008/ADR-009 already run every 5 minutes) rather than waiting for the next scheduled tick.
  Result: `{"ok":true,...,"dailyKpisUpserted":1,"dailyKpiErrors":[],"failures":[]}` — zero errors,
  one `PlantDailyKpi` row written on the very first cycle against the new production deployment.
- Queried the written row directly: `pvYieldKwh: 743.61` (`day_power`), `consumptionKwh: 684.6`
  (`day_use_energy`), `exportedEnergyKwh: 199.31` (`day_on_grid_energy`, reference-only),
  `localDate: 2026-07-19T21:00:00.000Z` (= `2026-07-20T00:00 Europe/Sofia`, correct for a
  UTC+3 summer offset), `rawPayload` containing the complete Huawei response including
  `total_power`/`month_power`/`day_income`/`total_income`/`real_health_state`. These are Huawei's
  own live counters at ingestion time — not a second figure to cross-check against a separate
  Huawei call, since the ingested value *is* the Huawei value.
- Confirmed via `grep` that `getStationRealKpi`/`getFusionSolarPlantRealTimeData` is referenced only
  in `plant-data.ts` (the function itself), `import-plant-daily-kpi.ts` (the one ingestion call
  site), the pre-existing `/api/diag/fusionsolar-plant-realtime` diagnostic route (manual
  investigation tooling, not part of the live Dashboard/Market data path), and doc comments in
  `schema.prisma` — `dashboard-data.ts` and `market/*.ts` contain no direct Huawei call for these
  KPIs.
- Not independently screenshotted through an authenticated browser session (production Dashboard
  sits behind real Google OAuth for the customer's own account, which requires interactive login);
  verified instead by direct database query against the exact row `dashboard-data.ts`'s
  `getPlantDailyKpi(plant.id, dayStart)` call will read, plus the passing production build/
  type-check of that exact call site.

### 8.4 Known follow-up (not done here, by design)

- Drop `PlantTelemetrySnapshot` in a dedicated cleanup migration once `PlantDailyKpi` has run in
  production for a while — deliberately deferred to avoid irreversible data loss in this milestone.
- `energy-metrics.ts`'s `computeEnergyMetricsFromSeries`/`computePlantEnergyMetrics`/`integrateKwh`
  have no remaining callers anywhere in the codebase after this migration. Left in place rather than
  deleted, since removing now-dead code is a separate decision from this milestone's scope — flagged
  here, not silently folded into this diff.
