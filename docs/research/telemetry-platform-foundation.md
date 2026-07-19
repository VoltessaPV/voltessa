# Telemetry Platform Foundation — Engineering Report

Status: **Implemented and validated against production.** Huawei is now a producer into
Voltessa's own telemetry store; nothing yet consumes it (Dashboard, Market, and automation are
all untouched — see "What was deliberately not done" below).

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
