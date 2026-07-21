# Telemetry Platform Foundation — Engineering Report

Status: **Implemented and validated against production**, now with continuous scheduled ingestion
(§8). Huawei is a producer into Voltessa's own telemetry store; Dashboard and Market both consume
it (see `docs/research/telemetry-consumer-migration.md`).

## 1. Why this exists

Every prior FusionSolar milestone (see `docs/research/fusionsolar-active-power-control.md`) read
Huawei live, on every request. That's fine for a real-time status badge, but it means every
future analytics feature (production curves, export/import totals, revenue, historical charts)
would otherwise require its own ad-hoc Huawei call, its own rate-limit exposure, and its own
re-derivation of the same raw KPIs. This milestone gives Voltessa its own historical record:
Huawei becomes one producer into a single table that every future consumer reads from instead.

## 2. Data model

One model, `DeviceTelemetry` (`prisma/schema.prisma`), deliberately not split by device type
(inverter/meter) or by resolution (5m/1h/1d):

- **Identity**: `organizationId`, `plantId`, `deviceId` (FKs) plus denormalized
  `huaweiDeviceId`/`devTypeId` (so a row stays self-describing even across a future device
  re-sync).
- **Time**: `timestamp` (the actual sample time) + `resolution` (`TelemetryResolution` enum:
  `FIVE_MIN`/`HOURLY`/`DAILY`, mapped to `"5m"`/`"1h"`/`"1d"` in the database). Only `FIVE_MIN` is
  populated today — `HOURLY`/`DAILY` exist so a future rollup job never needs a schema change.
- **Typed columns** — only the KPIs needed to answer "produced / exported / imported energy for
  this interval," everything else stays in raw JSON:
  - `activePower`, `inverterState`, `temperature` — inverter rows only (devTypeId 1).
  - `meterActivePower`, `meterStatus`, `activeEnergy`, `reverseActiveEnergy` — meter rows only
    (devTypeId 47).
  - Each column is `null` on the device type it doesn't apply to (confirmed in validation below —
    zero cross-populated rows).
- **`rawPayload` (`Json`)** — the complete, unmodified Huawei response item for that sample
  (`devId`/`collectTime`/`dataItemMap`, every field Huawei returned — 104 keys per inverter
  sample, 9 per meter sample in production). Future analytics reads this instead of re-importing
  from Huawei, per the milestone's explicit requirement.
- **`ingestedAt`**, **`source`** (`"HuaweiFusionSolar"`, stored explicitly rather than assumed).
- **Deduplication**: `@@unique([deviceId, timestamp, resolution])`. The importer writes via
  `createMany({ skipDuplicates: true })`, so re-running over an overlapping window is always
  safe — confirmed empirically (see §5).

**Explicitly never stored** (per the milestone's constraints): revenue, profit, savings,
self-consumption, or any export decision. Those are derived values that belong to a higher layer
and must always be computable from this table, never baked into it.

Schema applied via `prisma db push`, not a new migration. `prisma migrate status` was checked
before this change and showed the *existing* `PlantTelemetrySnapshot` migration
(`20260709140000_add_plant_telemetry_snapshot`) was never actually applied through Prisma's own
migration tooling — the table exists in the real database but isn't in `_prisma_migrations`,
meaning `db push` (not `migrate dev`/`deploy`) is the mechanism actually governing this database
today. This change follows that same real, working mechanism rather than adding a second
migration file that would be equally out of sync with reality.

## 3. Request contract — reused, not redesigned

Per the prior diagnostic milestone (see `docs/research/fusionsolar-active-power-control.md` and
the historical-KPI diagnostic route), two request shapes exist for `getDevFiveMinutes` across
Huawei's documentation history. Only the confirmed-working one is used:

```
{ devIds: "<comma-joined huaweiDeviceId list>", devTypeId: "<string>", collectTime: "<string ms>" }
```

The "newer" `devDn`/`startTime`/`endTime` shape was proven, against this same production tenant,
to fail with Huawei `failCode 20011` on every call (both device types, both windows) — see the
diagnostic milestone's report. It is not used anywhere in this implementation.

Huawei's contract only supports one calendar day per `collectTime` anchor (whichever day that
timestamp falls in). The importer covers an arbitrary `[windowStart, windowEnd]` by walking
backward from `windowEnd` in 24h steps until `windowStart` is reached — for this milestone's
"today + yesterday" window that produces exactly two anchors, matching the two calendar days
returned in production (see §5).

## 4. Architecture — three layers, matching existing repo conventions

- **`lib/fusionsolar/import-device-telemetry.ts`** — the pure importer. No HTTP awareness, no
  route knowledge. Input: a `FusionSolarConnection`, `organizationId`, `plantId`,
  `windowStart`/`windowEnd`. Output: a result summary (`samplesFetched`, `samplesInserted`,
  `duplicatesSkipped`, `unmatchedSamples`, `errors`). Devices are looked up scoped to
  `{ plantId, plant: { organizationId } }` — a mismatched pair yields zero devices rather than
  ever writing into the wrong organization.
- **`lib/fusionsolar/bootstrap-device-telemetry.ts`** — orchestration layer, mirroring
  `ingest-plant-telemetry.ts`'s existing shape exactly: iterates every `FusionSolarConnection`,
  every Huawei plant under it, calls the importer with a fixed `[now - 24h, now]` window (today +
  yesterday — "nothing older," per the milestone's explicit bootstrap scope).
- **`app/api/internal/fusionsolar/bootstrap-device-telemetry/route.ts`** — the manual trigger.
  Same `CRON_SECRET` bearer-token convention as the existing `ingest-plant-telemetry` route
  (`crypto.timingSafeEqual`, not `===`). **Not wired to any cron or scheduler** — manual execution
  only, exactly like `ingest-plant-telemetry` already is (see `CLAUDE.md`'s note on the reverted
  Vercel cron).

Unit conversion: Huawei's `active_power` is in **watts**, confirmed previously for the real-time
endpoint (`get-plant-power-status.ts`'s `wattsToKw`) and cross-checked again here against this
milestone's own historical data (a meter reading of `-3956` in `rawPayload` becomes `-3.96` in
`meterActivePower` — same scale, same sign convention: negative = importing). `activeEnergy` /
`reverseActiveEnergy` are stored exactly as Huawei returns them (`active_cap` /
`reverse_active_cap`) with no conversion — no existing convention confirms a scale factor for
those fields, so none was invented.

## 5. Bootstrap validation (production, 2026-07-19)

Triggered manually against `app.voltessa.ai` with the real `CRON_SECRET` (not available in local
dev — see "known limitation" below). Result reported by the route:

```
organizationsProcessed: 1, organizationsSucceeded: 1, organizationsFailed: 0
plantsProcessed: 1
samplesFetched: 1378, samplesInserted: 1378
duplicatesSkipped: 0, unmatchedSamples: 0
devicesRequested: 5
```

Independently re-verified directly against the database after the fact:

| Check | Result |
|---|---|
| Total rows | 1378 — matches `samplesInserted` exactly |
| Rows by devTypeId | 47 (meter): 328 samples, 1 device · 1 (inverters): 1050 samples, 4 devices |
| Timestamp range | `2026-07-17T21:20:00Z` → `2026-07-19T01:10:00Z` (today + yesterday, confirmed two distinct calendar days) |
| Distinct devices | 5 — matches `devicesRequested` (4 inverters + 1 meter, all of this plant's devices) |
| Device/meter mapping | Every row's `(deviceId, huaweiDeviceId, devTypeId)` cross-checked against the real `Device` table — **zero mismatches** |
| Duplicate `(deviceId, timestamp, resolution)` groups | **0** — unique constraint holds, confirming idempotency |
| Cross-type column leakage | **0** inverter rows with a meter column populated or an inverter column null; **0** meter rows with the reverse |
| Raw payload preserved | Sample inverter row: 104 `dataItemMap` keys intact. Sample meter row: 9 keys intact, matching the exact same field set found during the historical-KPI diagnostic (`active_cap`, `active_power`, `grid_frequency`, `meter_i`, `meter_status`, `meter_u`, `power_factor`, `reactive_power`, `reverse_active_cap`) |

No issues found. The data model, importer, and bootstrap route behave exactly as designed.

## 6. What was deliberately not done

- **Market page, Dashboard**: untouched. Neither reads from `DeviceTelemetry` yet.
- **Automation**: untouched. No export decision reads this table.
- **Cron/scheduling**: none added. The bootstrap route requires a manual authenticated call,
  exactly like the pre-existing `ingest-plant-telemetry` route.
- **Revenue/profit/savings/self-consumption/export-decision storage**: none — explicitly excluded
  per the milestone's constraints; these remain higher-layer, derived values.
- **Hourly/daily rollups**: schema supports them (`TelemetryResolution.HOURLY`/`DAILY`), nothing
  populates them yet.
- **Backfill beyond yesterday**: bootstrap is hardcoded to `[now - 24h, now]`. Importing older
  history is future work, not attempted here.

## 7. Known limitation carried into this milestone

Local development has no `FUSIONSOLAR_GATEWAY_URL`/`FUSIONSOLAR_GATEWAY_SECRET`/`CRON_SECRET` —
this sandbox redacts real secret-like values the moment they'd be used by a locally spawned
process, so the bootstrap route can only be meaningfully exercised against the deployed
production environment, triggered manually with the real `CRON_SECRET`. This is the same
limitation already documented in the historical-KPI diagnostic milestone; it did not block this
milestone, but every future change touching the gateway or `CRON_SECRET`-gated routes should
expect the same constraint.

## 8. Continuous Telemetry Ingestion (Scaleway Cron) — follow-up milestone

§6 above listed "Cron/scheduling: none added" as deliberately out of scope. A later milestone (the
Mathematical Correctness milestone, `docs/research/telemetry-consumer-migration.md` §14) added a
temporary GitHub Actions schedule for this reason. This milestone replaces that workaround with the
real, permanent scheduler and traces the complete pipeline end to end, per the milestone's own
instruction to verify every stage before changing anything.

### 8.1 Pipeline trace (as it exists after this milestone)

```
Scaleway systemd timer (voltessa-telemetry-ingestion.timer, OnCalendar=*:0/5)
  -> voltessa-telemetry-ingestion.service (curl, Bearer CRON_SECRET)
  -> POST https://app.voltessa.ai/api/internal/fusionsolar/bootstrap-device-telemetry?days=1
  -> route.ts: crypto.timingSafeEqual auth check
  -> bootstrapDeviceTelemetry() (lib/fusionsolar/bootstrap-device-telemetry.ts)
  -> importDeviceTelemetry() (lib/fusionsolar/import-device-telemetry.ts)
  -> Huawei getDevFiveMinutes (via the FusionSolar gateway, ADR-004)
  -> DeviceTelemetry (createMany, skipDuplicates: true)
  -> Dashboard / Market (getLatestTelemetry, getPlantTelemetryRange, lib/telemetry/queries.ts)
```

Every stage was verified directly against production, not assumed — see below.

### 8.2 What the existing Scaleway cron actually was

Production already ran a Scaleway VM, `voltessa-fusionsolar-proxy` (51.15.103.175) — the same host
that runs the FusionSolar gateway proxy (ADR-004, `/opt/voltessa-fusionsolar-proxy/server.js`, its
own separate `systemd` service, untouched by this milestone). Investigated directly over SSH:

- A `systemd` timer/service pair, `voltessa-telemetry-ingestion.timer`/`.service`, already existed
  and had been running every 15 minutes since 2026-07-09 — **before** the GitHub Actions workaround
  was ever added, and entirely invisible to that milestone (it lives outside this repository).
- `journalctl -u voltessa-telemetry-ingestion.service` showed **every single run failing with HTTP
  401**, back to the earliest retained log entries. Root cause, confirmed rather than guessed: the
  `CRON_SECRET` in the server's `/etc/voltessa-telemetry-scheduler.env` (last written 2026-07-09)
  no longer matched Vercel production's `CRON_SECRET` — the two had drifted apart at some point
  after initial setup (Vercel's own env history shows this var was last changed independently of
  the server file).
- Separately, and more importantly: the service targeted
  `/api/internal/fusionsolar/ingest-plant-telemetry`, the *legacy* pre-`DeviceTelemetry` route
  (`ingestFusionSolarPlantTelemetry` -> `syncFusionSolarPlantTelemetry` -> `PlantTelemetrySnapshot`
  snapshots — a different table `DeviceTelemetry`'s own consumers, Dashboard and Market, never
  read). Even with correct auth, this cron would never have kept Dashboard/Market fresh — it was
  pointed at the wrong pipeline entirely.

So the actual state before this milestone was: one broken (401) scheduler hitting the wrong
endpoint, plus one working-but-temporary GitHub Actions schedule hitting the right endpoint. Not
"no scheduler," and not "a working Scaleway scheduler" either — the brief's premise needed
correcting in both directions, which is why this was investigated before any change was made.

### 8.3 `CRON_SECRET` is a Vercel "Sensitive" variable — this changes how it must be handled

`vercel env pull --environment=production` returned *a* value for `CRON_SECRET`, but that value did
not authenticate against the live production endpoint (confirmed: a concurrently-running GitHub
Actions workflow, using the real repository secret, succeeded against the exact same endpoint at
the exact same time). `vercel env ls` confirms `CRON_SECRET` is stored as `Sensitive` — Vercel's
write-only variable type, which cannot be read back in plaintext by any CLI/dashboard operation
once set, by design. This means **the true prior value could not be recovered** to simply copy onto
the Scaleway host. The fix was to rotate: generate a new 32-byte random secret, set it as the new
`CRON_SECRET` (Production + Preview, still `--sensitive`), and write that same new value to
`/etc/voltessa-telemetry-scheduler.env` (root-only, `chmod 600`). A production redeploy was required
before the new value took effect — Vercel serverless functions read environment variables from the
deployment's own snapshot, not a live store, confirmed empirically (the new secret 401'd until the
next deploy, then worked).

### 8.4 Endpoint idempotency — re-verified against production, not re-assumed

Called `bootstrap-device-telemetry?days=1` twice in immediate succession against production:

| Run | samplesFetched | samplesInserted | duplicatesSkipped |
|---|---|---|---|
| 1st | 1288 | 21 | 1267 |
| 2nd (immediately after) | 1288 | **0** | 1288 |

Zero new rows on the second call, every fetched sample correctly recognized as a duplicate — the
`(deviceId, timestamp, resolution)` unique constraint + `createMany({ skipDuplicates: true })`
design (ADR-007) holds exactly as intended. No code change was needed for idempotency itself; this
is what makes a 5-minute schedule (whose `days=1` window necessarily overlaps the previous call's)
safe to run continuously. An empty `rows` array (no new/matching samples) already returns early
without inserting or erroring (`import-device-telemetry.ts`), so "no new telemetry exists" is also
already a no-op, not a failure.

### 8.5 Freshness — re-verified, not re-fixed

"Last Update" was already wired to `getLatestTelemetry` (direct `DeviceTelemetry` query, ordered by
`timestamp desc`) by the prior Market UX Completion milestone — confirmed by reading
`lib/telemetry/queries.ts` and its call sites, not reintroduced. This milestone is infrastructure-
only and made no changes to Dashboard, Market, or any other UI, per its own constraints; nothing
here needed to change for freshness to be correct once ingestion itself runs reliably.

### 8.6 Logging added

`bootstrap-device-telemetry`'s route and service now log: a start timestamp, a per-plant summary
(organization, plant, samples fetched/inserted, duplicates skipped, unmatched samples, errors) as
each plant is processed, and a completion summary (duration, per-organization success/failure
counts, aggregate totals, failures) whether the call succeeds or throws. Verified live in Vercel's
runtime logs after deployment — both the per-plant and completion log lines appear exactly as
designed for real production invocations.

### 8.7 Failure handling — verified, not changed

`bootstrapDeviceTelemetry` already wraps each organization's processing in its own `try`/`catch`
(unchanged): one organization's failure is recorded in `failures` and does not stop the loop over
the remaining organizations, and — because each scheduled run is an independent, stateless
serverless invocation triggered fresh by the next timer tick — a single failed execution can never
prevent the next one from running. No code change was required to satisfy this; verified by reading
the existing control flow, not assumed.

### 8.8 Production verification

After deploying the logging change and rotating `CRON_SECRET`, the reconfigured Scaleway timer
(`OnCalendar=*:0/5`) was observed directly via `journalctl` for two consecutive real (not manually
triggered) executions:

| Run | Time (UTC) | Result |
|---|---|---|
| 1 | 2026-07-19 22:50:04 | `ok:true`, 3 new samples inserted, 1288 duplicates skipped, `Finished` (success) |
| 2 | 2026-07-19 22:55:01 | `ok:true`, 3 new samples inserted, 1291 duplicates skipped, `Finished` (success) |

Exactly 5 minutes apart, both successful, both idempotent (no unexpected duplicate growth), no
failed executions. `.github/workflows/telemetry-ingest.yml` and its GitHub repository secret were
deleted only after this confirmation — there is now exactly one production scheduler.

### 8.9 Why 5 minutes for telemetry, 15 minutes for settlement

`DeviceTelemetry` samples arrive from Huawei on a 5-minute grid already (`TelemetryResolution.
FIVE_MIN`); financial settlement (Market's revenue/price-interval calculations,
`SETTLEMENT_INTERVAL_MINUTES`) is unchanged at 15 minutes and this milestone made no changes to any
financial calculation. Refreshing telemetry every 5 minutes means fresh operational data is always
available *before* each 15-minute settlement interval closes (up to three fresh samples per
interval), which future automation logic can react to intra-interval — the reason stated in the
milestone brief for choosing 5 minutes specifically rather than matching the settlement cadence.

### 8.10 What was deliberately not touched

No changes to Dashboard, Market, or any other UI/component. No changes to `import-device-telemetry.
ts`'s Huawei request logic, `DeviceTelemetry`'s schema, or any financial/settlement calculation. The
legacy `ingest-plant-telemetry` route/`PlantTelemetrySnapshot` path was left in place (still dormant,
no longer invoked by anything scheduled) — retiring it outright is a separate decision, not made
here.

## 9. Database-First Telemetry Architecture (follow-up milestone)

Status: **Implemented and verified against production data.** See ADR-011
(`docs/ARCHITECT_DECISIONS.md`) for the full decision record — this section records the
investigation trail and production evidence, not repeated there.

### 9.1 Why this exists

A multi-session investigation (Huawei request inventory, a full Dashboard/Market render-graph trace,
Huawei's own documented rate limits, and a from-scratch architecture redesign pass) found that
Dashboard issued 4 live Huawei calls per render and Market 3, none cached, none deduplicated across
a browser refresh — and that Huawei's own documented per-account daily quota for the 5-minute
interface is plausibly already exceeded by the unchanged 5-minute scheduler alone (§8.9's own
reasoning for choosing 5 minutes did not weigh this quota, since it wasn't yet known at the time).
Correlated against real production evidence: the same day this investigation began, a burst of
manual Active Power Control experiments (Zero Export / No Limit × Plant DN / Smart Dongle DN) landed
on the same Huawei account/token as the scheduler and Dashboard/Market traffic, coinciding with
observed `failCode 407` (Huawei's documented "access frequency exceeded" code) and an intermittently
disappearing System Overview card.

### 9.2 What changed

Huawei is now a synchronization-only backend for Dashboard/Market — see ADR-011 for the full
decision. In one sentence: `Huawei -> lib/fusionsolar/telemetry-sync-service.ts -> Postgres ->
Dashboard/Market`, never `Huawei -> UI` directly.

### 9.3 Production verification

Run directly against the real database (`getDashboardPageData`, no `FUSIONSOLAR_GATEWAY_*`
configured locally — the standing local-dev condition this investigation already relied on
repeatedly):

- **First call** (connection's telemetry stale): the sync service attempted a real sync, every
  Huawei-calling step failed with `FusionSolar gateway environment variables are not configured`
  (expected — no local gateway credentials), each failure was caught and logged by the *existing*
  `importDeviceTelemetry`/`importPlantDailyKpi` per-item error handling (unchanged, reused) rather
  than thrown, and the page still rendered complete, real, non-fabricated data
  (`producedTodayKwh: 480.04`, `energyFlow.pvKw: 109.83`, `inverters.available: true`, etc.) straight
  from `DeviceTelemetry`/`PlantDailyKpi`.
- **Second call, immediately after**: zero sync attempt logged at all — `telemetryLastSyncedAt`
  from the first call was still within `FUSIONSOLAR_SYNC_FRESHNESS_MS`, so the freshness gate
  short-circuited before any Huawei-calling code ran, and the page rendered identical real values.
- **Lease state after both calls**: `telemetrySyncStatus: "IDLE"` — the lease was correctly released
  in both cases (the `finally` block), never left stuck.

This is the primary acceptance criterion, proven directly rather than only reasoned about: Dashboard
renders correctly from the database even when Huawei is completely unreachable, provided the
required telemetry already exists in Postgres.

### 9.4 What was deliberately not done this milestone

- **Scheduler cadence unchanged** — still every 5 minutes (`voltessa-telemetry-ingestion.timer`,
  ADR-008). Reducing it is an explicitly separate, later milestone; `FUSIONSOLAR_SYNC_FRESHNESS_MS`
  is the one constant that milestone will raise.
- **Configured Export Mode persistence** — deferred; no new table/columns added for it. Dashboard/
  Market render the same "unavailable" state this field already showed in production (`failCode
  20609`, throughout the whole Active Power Control investigation) — zero regression, since live and
  cached both resolved to "unavailable" for the one real plant regardless.
- **The `bootstrap-device-telemetry` route's `?days=N` one-time-backfill parameter** was not carried
  forward into the new per-connection sync service — a future large historical backfill needs a
  dedicated one-off script.
- **Manual Huawei Control and engineering diagnostics** — untouched. Control dispatch
  (`huawei-control-service.ts`) and diagnostics (`app/api/diag/*`, `scripts/diagnostics/
  huawei-control.ts`) are not wired to the sync gate in either direction, per this milestone's
  explicit constraint (control commands and synchronization are separate concerns).
