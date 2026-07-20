# FusionSolar Active Power Control — Investigation Record

Status: **Current implementation baseline** as of this document's creation. This is the canonical
baseline for the automated export-control milestone. Future implementation should build on the
documented facts recorded here rather than repeating this investigation. Do not reopen, re-search
Huawei documentation, or re-litigate disproven hypotheses from this record unless new evidence
becomes available.

Scope: this document covers only the FusionSolar/Huawei Northbound API export-control
investigation (proving remote read/write capability for grid export limitation). It does not
cover the separate Google OAuth/PKCE host-canonicalization work done earlier in the same
sprint — that was a different, already-shipped, already-documented investigation.

---

# Architecture

Complete data flow as it exists today, plus the one stage not yet built:

```
Huawei Cloud (SmartPVMS Northbound API)
        │
        ▼
Voltessa FusionSolar Proxy   (external gateway service — FUSIONSOLAR_GATEWAY_URL /
        │                     FUSIONSOLAR_GATEWAY_SECRET, per ADR-004; not in this repo)
        ▼
Huawei helper layer          (apps/web/lib/fusionsolar/*.ts — callFusionSolarApi() in
        │                     api-client.ts is the single shared client; get-active-power-
        │                     control-mode.ts, device-real-time-kpi.ts, export-control.ts,
        │                     sync-devices.ts, sync-plants.ts, sync-plant-telemetry.ts all
        │                     build on it)
        ▼
Prisma                        (Plant, Device incl. huaweiDeviceId, FusionSolarConnection,
        │                     PlantTelemetrySnapshot — apps/web/prisma/schema.prisma)
        ▼
Diagnostic endpoints          (apps/web/app/api/diag/fusionsolar-*, session-auth-gated,
        │                     manual-trigger only — the current de facto verification
        │                     surface for this integration, per docs/TESTING.md)
        ▼
Production dashboard (future) — not yet implemented. Nothing today reads export-control
                                 state anywhere other than the diagnostic routes above.
```

Every layer through "Diagnostic endpoints" exists and has been exercised against the real
production plant. The dashboard layer is the only stage in this diagram that remains future work.

---

## 1. Chronological summary

1. **Automation milestone review.** Reviewed the existing codebase for the "first automated
   trading decision" milestone (price threshold → export limit). Found: a complete FusionSolar
   *read* pipeline already in production (OAuth, token refresh, gateway proxy, telemetry sync,
   15-minute cron ingestion) but **no write/control capability anywhere in the repository**
   (neither `apps/web` nor the unwired `apps/api` prototype — `apps/api`'s own `FusionSolarClient`
   stub throws `Not implemented` for `stopExport`/`resumeExport`/`getExportMode`). No market-price
   integration. No persisted automation/threshold/command-log schema in `apps/web`. Proposed a
   small-commit roadmap; flagged the FusionSolar control-API contract as the single largest
   unknown requiring a research spike before any implementation.

2. **Write-side research spike.** Researched Huawei's Northbound API for export-limit control via
   web search (multiple independently-corroborating official Huawei doc pages, since direct
   fetches of `support.huawei.com` return empty content in this environment — a **confirmed,
   systemic tooling limitation** exercised dozens of times across this entire investigation, not
   a one-off failure). Found the "v2 control" family: a dispatch endpoint and a task-status query
   endpoint, plus a documented `pvms.openapi.control` OAuth scope requirement (distinct from
   `pvms.openapi.basic`, granted separately by the FusionSolar company admin). Implemented
   `lib/fusionsolar/export-control.ts` (`setExportLimit`, `restoreExport`,
   `getActivePowerControlTaskStatus`) — **never wired to any route, cron, or UI; never committed
   to git; never executed against the real API.** Provided manual-testing instructions and a risk
   assessment. Explicitly did not implement automation, cron, UI, or schema changes.

3. **Read-side attempt #1 (`getDevRealKpi`/`getStationRealKpi`).** Investigated whether the
   already-used real-time telemetry endpoints expose export-control state. Found, via web search,
   that neither endpoint's documented field list contained a control-mode/limitation field.
   Cross-checked against a real third-party open-source integration built on the same API tier
   (exposes only measurement sensors). Concluded — correctly, later confirmed with the full
   official field tables — that these endpoints do not expose configured export-limit state.

4. **Read-side attempt #2 (`/v1/configuration/active-power-control-mode`).** After repeated failed
   attempts to fetch the relevant Huawei doc page directly, the user retrieved and provided the
   endpoint path directly: `POST /rest/openapi/pvms/nbi/v1/configuration/active-power-control-mode`.
   Implemented `lib/fusionsolar/get-active-power-control-mode.ts` (read-only helper, reusing
   `callFusionSolarApi`) and a diagnostic route,
   `app/api/diag/fusionsolar-active-power-control/route.ts`, mirroring the existing diagnostic
   route convention. Initially typed the provider-specific param objects as `Record<string,
   unknown>` pending confirmation of exact field names.

5. **Type refinement.** The user supplied the exact documented field shapes
   (`LimitationMode`, `ZeroExportLimitationParam`, `LimitedPowerGridValueParam`,
   `LimitedPowerGridPercentParam`). Replaced the placeholder types, and separated an internal
   (unexported) wire-shape type from the public exported model type. Committed as **`735ebe5`**.

6. **HTTP 400 instrumentation.** The `/v1/configuration/active-power-control-mode` call returned
   HTTP 400 in production. Instrumented (not fixed — explicitly no business-logic change, no
   retries, no workarounds): added `headers` capture to `FusionSolarApiError` in `api-client.ts`
   (all three existing throw sites), added request/response diagnostic logging in
   `get-active-power-control-mode.ts`, and surfaced the full upstream error (status, headers, raw
   body, parsed `success`/`failCode`/`message`) directly in the diagnostic route's own JSON
   response. Committed as **`b7cc780`**.

7. **`getDevRealKpi` production data analysis.** A separate diagnostic route,
   `app/api/diag/fusionsolar-device-realtime/route.ts` (and its supporting helper
   `lib/fusionsolar/device-real-time-kpi.ts`, plus a `Device.huaweiDeviceId` Prisma field and a
   `sync-devices.ts` update to populate it), was added to the repository as **commit `7d439aa`** —
   **not made in this investigation's sessions**; discovered already present in `git log` and
   read directly to understand its behavior. The user ran it against the real production plant
   ("Atlanta") and pasted the raw response. Full field-by-field analysis performed (see
   "Evidence" below). Along the way, one pasted payload was initially mis-attributed (it was
   actually from the pre-existing `fusionsolar-sync-devices` diagnostic, a device
   catalog/inventory endpoint, not `getDevRealKpi`) — caught and corrected before drawing any
   conclusion from it.

8. **`inverter_state` deep dive.** Focused specifically on decoding the observed
   `inverter_state: 512` value. Found a plausible decode via an independent, actively-maintained
   open-source Huawei inverter library (sourced from Huawei's *Modbus* protocol documentation, a
   different document from the cloud API reference), quoted directly from its source file via the
   GitHub API. Explicitly flagged as well-evidenced but not yet authoritative for the cloud API
   specifically.

9. **Authoritative confirmation.** The user retrieved and pasted the full, real content of the
   official SmartPVMS Northbound API Reference "Configuration" chapter page (previously
   unreachable via this environment's fetch tooling), which also included the full "Monitoring"
   chapter's `getDevRealKpi`/`getStationRealKpi` field tables and the official `Table 5-1`/`Table
   5-2 Inverter state (inverter_state) description` enumeration. This fully confirmed the
   community-sourced decode (512 = "Grid-connected") against Huawei's own cloud API documentation
   directly — no longer an inference.

10. **Task-info endpoint cross-check.** The user pasted the official documentation for "API for
    Querying Inverter Active Power Setting Tasks" (`.../v2/control/active-power-control/task-info`).
    Compared against the existing (still uncommitted, still unwired) `export-control.ts` types and
    found concrete type discrepancies (see "Evidence") — not fixed, since no code change was
    requested.

11. **Smart Dongle networking question.** Searched official Huawei documentation specifically for
    whether the `/v1/configuration/active-power-control-mode` query endpoint is documented as
    unsupported for Smart Dongle networking. Found the endpoint's own documented error codes are
    generic (not topology-specific), and found that a dedicated official FAQ on this exact failure
    mode exists by title but its content could not be retrieved. Reported this as an open unknown
    rather than inferring an answer.

12. **This document.** Investigation state recorded as the current implementation baseline.

---

## 2. Every endpoint tested or referenced

| Endpoint | Family | Method | Tested against production? | Result |
|---|---|---|---|---|
| `/thirdData/getStationRealKpi` | Monitoring (read) | POST | Yes (pre-existing, in use) | Works; no control-state field (confirmed by official doc) |
| `/thirdData/getDevRealKpi` | Monitoring (read) | POST | Yes | devTypeId 1 (4 inverters): success. devTypeId 47 (1 meter): success. devTypeId 62 (3 SDongles): **failCode 20013**, `data: null` |
| `/thirdData/stations` (Plant List API) | Basic (read) | POST | Yes (pre-existing, in use) | Works |
| `/thirdData/getDevList` (Device List API) | Basic (read) | POST | Yes (pre-existing, in use) | Works |
| `/thirdData/getAlarmList` | Alarm (read) | POST | Not tested in this investigation | Documentation only |
| `/thirdData/getKpiStationHour/Day/Month/Year` | Report (read) | POST | Not tested in this investigation | Documentation only; no control-state fields |
| `/thirdData/getDevKpiDay/Month/Year` | Report (read) | POST | Not tested in this investigation | Documentation only; no control-state fields |
| `/rest/openapi/pvms/nbi/v1/configuration/active-power-control-mode` | Configuration (read) | POST | Yes | **Production result: `failCode 20609`** (per user report; reason not fully diagnosed — see §7 unknowns) |
| `/rest/openapi/pvms/nbi/v1/configuration/battery-mode` | Configuration (read) | POST | Not tested; adjacent, unused | Documentation only |
| `/rest/openapi/pvms/nbi/v2/control/active-power-control/async-task` (delivering a task) | Control (write) | POST | **Never called** | Endpoint path confirmed via web search; full request body shape (specifically the top-level wrapper key, assumed `plantList`) **not independently confirmed** with the same rigor as the other endpoints |
| `/rest/openapi/pvms/nbi/v2/control/active-power-control/task-info` (querying a task) | Control (read, but scoped to self-dispatched tasks only) | POST | **Never called** (no task has ever been dispatched) | Full spec confirmed via official documentation, pasted directly |

---

## 3. Diagnostic endpoints created (all currently in place — must not be removed, see §10)

| Route | Created by | Purpose |
|---|---|---|
| `app/api/diag/fusionsolar-active-power-control/route.ts` | This investigation (commit `735ebe5`, instrumented further in `b7cc780`) | Calls `getActivePowerControlMode()` against the real connected plant; on failure, surfaces the complete upstream HTTP status/headers/body/parsed fields directly in its JSON response |
| `app/api/diag/fusionsolar-device-realtime/route.ts` | **Not this investigation** — found already committed as `7d439aa` | Calls `getDevRealKpi` per `devTypeId` group for all of an organization's devices; used to obtain the production payload analyzed in "Evidence" below |
| `app/api/diag/fusionsolar-sync-devices/route.ts` | Pre-existing (predates this investigation entirely) | Device catalog sync — **not telemetry**; briefly and mistakenly treated as the source of a pasted payload during this investigation before being correctly identified |
| `app/api/diag/fusionsolar-stations`, `fusionsolar-devices`, `fusionsolar-dns`, `fusionsolar-plant-realtime`, `fusionsolar-connection`, `fusionsolar-sync-plants`, `fusionsolar-sync-plant-telemetry` | Pre-existing | Unrelated to this investigation; listed for completeness since they share the same diagnostic-route convention |

---

## 4. Production code added

Every production change introduced during (or discovered as part of) this investigation:

- **`Device.huaweiDeviceId` (Prisma field)** — `BigInt?` on `Device`, added in commit `7d439aa`
  (not authored in this investigation's sessions, but verified present and relied upon). Stores
  Huawei's numeric device identifier, used only for Huawei API calls such as `getDevRealKpi`.
- **`sync-devices.ts` persistence** — updated (commit `7d439aa`) to populate
  `huaweiDeviceId: BigInt(device.id)` from `/thirdData/getDevList`'s `id` field on every device
  sync.
- **FusionSolar helper modules:**
  - `lib/fusionsolar/get-active-power-control-mode.ts` — created and refined in this investigation
    (`735ebe5`, `b7cc780`).
  - `lib/fusionsolar/export-control.ts` — created in this investigation; **still uncommitted**.
  - `lib/fusionsolar/device-real-time-kpi.ts` — commit `7d439aa`, not this investigation's
    sessions.
  - `lib/fusionsolar/api-client.ts` — modified in this investigation (`b7cc780`) to add a
    `headers` field to `FusionSolarApiError`, captured at all three existing throw sites.
- **Diagnostic endpoints:** `app/api/diag/fusionsolar-active-power-control/route.ts` (this
  investigation, `735ebe5`/`b7cc780`) and `app/api/diag/fusionsolar-device-realtime/route.ts`
  (commit `7d439aa`, not this investigation's sessions).
- **Proxy allowlist additions:** **None.** No changes to `proxy.ts` were made as part of this
  investigation. (A `proxy.ts` host-canonicalization change exists in the repository's history —
  commit `47e4ce0` — but that belongs to the separate, already-completed Google OAuth/PKCE
  investigation, out of scope here.)
- **Prisma changes:** the `Device.huaweiDeviceId` field above is the only schema change touching
  this investigation; no other model or field was added or altered.

## 5. Every committed SHA relevant to this work

| SHA | Message | Made in this investigation's sessions? |
|---|---|---|
| `735ebe5` | `feat(fusionsolar): read-only active power control mode diagnostic` | Yes |
| `b7cc780` | `debug(fusionsolar): instrument active-power-control diagnostic with full upstream error` | Yes |
| `7d439aa` | `feat(fusionsolar): add device-realtime KPI discovery diagnostic` | **No** — found pre-existing in `git log`, read and relied upon, not authored here |

`apps/web/lib/fusionsolar/export-control.ts` remains **uncommitted** (untracked) — no SHA exists
for it.

---

# Evidence

## Huawei documentation

*(Retrieved either directly from official Huawei doc pages pasted verbatim by the user into this
investigation, or — in one explicitly-marked case — from a direct GitHub API fetch of open-source
library source.)*

- `getStationRealKpi`'s full documented field list: `day_power`, `month_power`, `total_power`,
  `day_income`, `total_income`, `day_on_grid_energy`, `day_use_energy`, `real_health_state` — no
  control-state field.
- `getDevRealKpi`'s full documented field list per device type (string inverter, residential
  inverter, EMI, grid meter, power sensor, residential battery, C&I/utility ESS, and several
  Power-M-scenario device types) — the only field with any relationship to export-control state is
  `inverter_state` (string/residential inverter device types only).
- **`inverter_state` is an officially documented enumeration** (`Table 5-1`/`Table 5-2 Inverter
  state (inverter_state) description`, identical in both the Real-Time and Historical Device Data
  interfaces) — a single discrete value, **not a combinable bitmask**. Full table: `0`–`3` various
  standby sub-states, `256` Start, **`512` Grid-connected**, **`513` Grid-connected: power
  limited**, **`514` Grid-connected: self-derating**, `768`–`774` various shutdown reasons,
  `1025`/`1026` grid-scheduling curves, `1280`/`1281` terminal test, `1536` inspection, `1792` AFCI
  self-check, `2048` I-V scanning, `2304` DC input detection, `40960` standby (no irradiation),
  `45056`/`49152` SmartLogger-written states.
- The `/v1/configuration/active-power-control-mode` query endpoint's full request/response
  contract, matching exactly what was implemented in `get-active-power-control-mode.ts`:
  `controlMode` ∈ `{noLimit, zeroExportLimitation, limitedPowerGridKW, limitedPowerGridPercent,
  other}`, with `zeroExportLimitationParam{limitationMode}`,
  `limitedPowerGridValueParam{limitationMode, maxGridFeedInPowerValue}`,
  `limitedPowerGridPercentParam{limitationMode, maxGridFeedInPowerPercent}`, and
  `limitationMode` ∈ `{totalPower, singlePhasePower}`.
- The `/v2/control/active-power-control/task-info` endpoint's full contract: `dispatchResult[]`
  with `plantCode`, `controlMode` (string `"0"`/`"6"`, **not** the named-enum style used by the
  v1 configuration endpoint), `status` ∈ `{RUNNING, SUCCESS, FAIL}`, `message` ∈ `{FAILURE, TIMEOUT,
  BUSY, INVALID, EXCEPTION}` (only populated on `FAIL`), `controlInfo{maxGridFeedInPower: number,
  limitationMode: "0"|"1" (string)}`, plus top-level `startTime`/`endTime`.
- Two structurally different string-encoding conventions exist across the two "similar concept"
  API families: v1 `configuration` uses named string enums (`"noLimit"`, `"limitedPowerGridKW"`,
  `"totalPower"`); v2 `control` uses numeric-string codes (`"0"`, `"6"`, `"1"`). Not interchangeable.
- OAuth: a `pvms.openapi.control` scope exists, distinct from `pvms.openapi.basic`, granted
  separately by the FusionSolar company administrator (System → Company Management → Northbound
  Management) — an account-level grant outside any code change.

## Production observations

- `getDevRealKpi` succeeds for devTypeId `1` (4 inverters, model `SUN2000-50KTL-M3`) and `47`
  (1 meter, `Meter1`); fails for devTypeId `62` (3 SDongles).
- All four production inverters reported `inverter_state: 512` (Grid-connected) simultaneously.
- The meter's `active_power` (~55.9 kW / `55885`) closely matched the sum of the four inverters'
  `active_power` (~57.4 kW) — consistent with unrestricted export at the time of the snapshot, not
  a zero-export or limited condition.
- `/v1/configuration/active-power-control-mode` returns `failCode 20609` against the real
  production plant (per user report).

## Diagnostic responses

- `app/api/diag/fusionsolar-device-realtime` returns `{ ok, organizationId, deviceCount,
  devicesMissingHuaweiDeviceId, realtimeByDevTypeId }`, where `realtimeByDevTypeId` is keyed by
  `devTypeId` and each entry carries either `{ ok: true, getDevRealKpi: [...] }` or
  `{ ok: false, upstream: { httpStatus, failCode, message, responseBody } }` on failure — this is
  exactly how the devTypeId `62` failure (`failCode 20013`) was captured.
- `app/api/diag/fusionsolar-active-power-control` returns the helper's result directly on success,
  or (since `b7cc780`) a structured `upstream` object — `httpStatus`, `headers`, `responseBody`,
  parsed `success`/`failCode`/`message` — directly in its own JSON response on failure.

## Confirmed fail codes

- **`20013`** — `getDevRealKpi`, devTypeId `62` (SDongle), this plant. Meaning not documented
  anywhere retrieved in this investigation.
- **`20609`** — `/v1/configuration/active-power-control-mode`, this plant. Documented generic
  meaning: "The plant networking is not supported" / "...the active power control mode of the
  inverter cannot be determined," triggered when "the input plant is networked with multiple
  devices." Plant-specific cause not confirmed (see "Remaining unknowns").
- `20629`, `20631`, `20614` — documented error examples for the same configuration endpoint, not
  observed in production for this plant (production returned `20609`, not these).

## Confirmed `inverter_state` values

- **`512` = Grid-connected** — the only value observed in production (all four inverters,
  simultaneously); matches the official `Table 5-1`/`5-2` enumeration exactly.
- `513` = Grid-connected: power limited — documented, **not observed** in this plant's data.
- `514` = Grid-connected: self-derating — documented, **not observed** in this plant's data.

---

## 6. Confirmed limitations

- `getDevRealKpi`/`getStationRealKpi` (Monitoring family) do not expose configured export limit or
  control mode — confirmed by their complete official field tables, not merely by absence of
  effort to find one.
- `inverter_state` exposes a **qualitative** state (grid-connected / power-limited / self-derating
  / various shutdown-with-reason states) but **not the numeric configured limit value** — the
  numeric value (kW or %) is only available from the separate `/v1/configuration/...` or `/v2/
  control/...` families.
- The `/v2/control/active-power-control/task-info` query can only report on tasks **this
  integration itself dispatched** — it cannot read a manually-configured state (e.g. one set
  directly in the FusionSolar UI) since there is no `taskId` for it.
- `getDevRealKpi` fails outright for devTypeId `62` (SDongle) in this account/topology.
- `/v1/configuration/active-power-control-mode` fails with `failCode 20609` for this production
  plant.
- This environment's `WebFetch` tool cannot retrieve content from any `support.huawei.com` or
  `support.huawei.cn` page — confirmed systematically across at least fifteen distinct attempts
  throughout this investigation. All directly-quoted official documentation in this record came
  from the user pasting real page content, not from a successful fetch.

## 7. Remaining unknowns

- **The exact reason `failCode 20609` occurs for this specific plant/topology.** The generic
  documented condition ("networked with multiple devices") is known; whether this is specifically
  because of the Smart Dongle networking topology is **not confirmed either way**. A dedicated
  official Huawei FAQ titled "Why Is failCode 20609 Returned When the API for Querying the Battery
  Working Mode and API for Querying an Inverter Active Power Control Mode Are Called?" is
  confirmed to exist (by title, across multiple SmartPVMS doc versions) but its content could not
  be retrieved.
- Whether Smart Dongle networking is officially documented as supported/unsupported for the
  `/v1/configuration/active-power-control-mode` **query** endpoint specifically (as opposed to the
  *delivery* endpoint, which does document Dongle as a supported controller type for that
  different, write-side operation — not assumed to transfer to the query endpoint).
- The exact top-level request body shape for `/v2/control/active-power-control/async-task`
  (dispatching a task) — inferred as `{ plantList: [...] }` in `export-control.ts`, never
  confirmed, since that endpoint has never been called.
- Whether `inverter_state = 512` at the moment of the observed snapshot generalizes to "this plant
  is never export-limited" or only describes that specific instant — it is a point-in-time
  observation, not a continuously-verified guarantee.

---

## 8. Findings by confidence category

### Confirmed by Huawei documentation
- Full `getStationRealKpi`, `getDevRealKpi` (all device types), Plant List, Device List, Alarm
  List, and Report-family field tables — none contain export-control state (except
  `inverter_state`, see above).
- `inverter_state`'s full official enumeration (`Table 5-1`/`5-2`), including `512 = Grid-connected`,
  `513 = Grid-connected: power limited`, `514 = Grid-connected: self-derating`.
- Full request/response contract for `/v1/configuration/active-power-control-mode` and
  `/v1/configuration/battery-mode`.
- Full request/response contract for `/v2/control/active-power-control/task-info`.
- `failCode 20609`'s and `20629`'s documented generic meanings for the configuration-query
  endpoints.

### Confirmed by production testing
- `getDevRealKpi` succeeds for devTypeId `1` (4 inverters) and `47` (1 meter); fails with
  `failCode 20013` for devTypeId `62` (3 SDongles).
- All four production inverters reported `inverter_state: 512` (Grid-connected) simultaneously.
- The meter's `active_power` (~55.9 kW) closely matched the sum of the four inverters' `active_power`
  (~57.4 kW) — consistent with unrestricted export at the time of the snapshot.
- `/v1/configuration/active-power-control-mode` returns `failCode 20609` against the real
  production plant (per user report).

### Inferred but NOT confirmed
- The precise reason this plant's networking topology triggers `failCode 20609`.
- Whether Smart Dongle networking is specifically, officially excluded from the
  `/v1/configuration/active-power-control-mode` query endpoint.
- The exact request body wrapper for the (never-called) task-dispatch endpoint.
- That a single point-in-time `inverter_state: 512` reading generalizes across time.

---

## 9. Final conclusion

**No Huawei read API has yet been confirmed to expose the currently configured export limit for
this production topology. The documented configuration endpoint exists, but currently returns
`failCode 20609` for this plant.**

- `getDevRealKpi` exposes real-time **telemetry** (electrical measurements, energy counters,
  qualitative device/communication status).
- `getDevRealKpi` does **NOT** expose the configured export limit (no numeric kW/% limit value
  anywhere in its documented field set).
- `inverter_state` **is officially documented** by Huawei (Table 5-1/5-2 of the SmartPVMS
  Northbound API Reference).
- `inverter_state` **does distinguish** Grid-connected (`512`) / Grid-connected: power limited
  (`513`) / Grid-connected: self-derating (`514`), among other states.
- **The production plant currently reports `inverter_state = 512` (Grid-connected)** — i.e., plain,
  unrestricted operation at the time it was queried.
- The documented configuration endpoint for reading export-control mode
  (`/rest/openapi/pvms/nbi/v1/configuration/active-power-control-mode`) **exists** and is fully
  specified in official Huawei documentation.
- **The production plant returns `failCode 20609`** for that endpoint.
- **The exact reason for `20609` is currently unknown** — the generic documented condition is
  known, the plant-specific cause is not.
- **No further reverse-engineering of `getDevRealKpi` is planned.** This endpoint's capability
  boundary is considered fully and authoritatively established.

---

## 10. Diagnostics preservation policy

All diagnostic routes listed in §3 — including `fusionsolar-active-power-control` and
`fusionsolar-device-realtime` — **must remain in place, unmodified**, until the production
dashboard has been implemented and independently verified against the same Huawei responses they
currently surface. Do not delete or alter them as part of any future, unrelated change without
explicit instruction.

## 11. Helper code preservation policy

The following must **not** be removed, even though currently unused/unwired:

- `lib/fusionsolar/export-control.ts` (`setExportLimit`, `restoreExport`,
  `getActivePowerControlTaskStatus`) — uncommitted, but retained as infrastructure for future work.
- `lib/fusionsolar/get-active-power-control-mode.ts` and its diagnostic route.
- `lib/fusionsolar/device-real-time-kpi.ts` and its diagnostic route.
- The `Device.huaweiDeviceId` Prisma field and its population in `sync-devices.ts`.
- The `headers` field added to `FusionSolarApiError` in `api-client.ts`.

These are considered infrastructure for future automation work, not dead code to be cleaned up.

---

## 13. Inverter `active_power` unit-conversion bug (Design-System Consistency milestone)

New evidence on a different question than §12's scope (the `20609` configuration-endpoint
mystery, still open) — this section is about `active_power`'s **unit**, not the configuration
endpoint, and does not reopen or contradict §12's rules.

### What was previously assumed

Every consumer of inverter `active_power` (`get-plant-power-status.ts`, `import-device-telemetry.ts`,
and the later `get-plant-inverter-status.ts`) divided the raw value by 1000, on the stated
assumption "Huawei reports `active_power` in watts" — a conversion originally confirmed only for
the **meter's** `active_power` (a real reading of `-1962` matching a physically sane `-1.96` kW
standby-import load) and generalized, without separate verification, to inverters too. §5's own
production observation above (`~55.9 kW` meter matching `~57.4 kW` summed inverters) reinforced
this assumption at the time.

### What was actually found

Investigating a Dashboard energy-conservation bug report led to querying
`/api/diag/fusionsolar-device-realtime` directly against production and separately reading 8 raw,
already-stored `DeviceTelemetry` rows (`rawPayload.dataItemMap.active_power`) for this plant's
inverters. Both sources agree, consistently, across multiple independent timestamps:

| Device | raw `active_power` | ÷1000 (previous code) | as-is (kW) |
|---|---|---|---|
| 4× `SUN2000-50KTL-M3` (50 kW-rated) inverters | `31`-`44` | `0.03`-`0.04` kW | `31`-`44` kW |
| Meter1 | `58862` | `58.86` kW | (not applicable — meter is watts) |

`0.03`-`0.04` kW from a 50 kW-rated inverter at genuine mid-morning production (with the meter
simultaneously showing ~59 kW flowing to the grid — energy that has to originate somewhere) is
physically absurd. `31`-`44` kW from the same inverter at the same moment is exactly the range a
50 kW inverter operating at 62-88% of rated capacity would show. **The inverter's `active_power` is
already in kW for this device type/model — the meter's field of the same name is in watts, but
they are not the same unit despite the shared Huawei field name** (already flagged as a real risk in
this document's own architecture notes — see the `meterActivePower`/`activePower` schema comment's
"same Huawei field name... but a different physical quantity" note, which correctly separated the
columns but not their units).

### Consequence and fix

Every "Produced"/production-power figure computed from `DeviceTelemetry.activePower` (Dashboard,
Market, and their shared `lib/telemetry/energy-metrics.ts`) had been under-reported by ~1000x since
the DeviceTelemetry table existed. `exportedKwh`/`importedKwh`/revenue were never affected — those
are derived exclusively from the meter's `activeEnergy`/`reverseActiveEnergy` counters, never from
`activePower`. Fixed by removing the `/1000` conversion for inverter `active_power` specifically
(`get-plant-power-status.ts`'s `inverterKw`, `get-plant-inverter-status.ts`'s `inverterKw`,
`import-device-telemetry.ts`'s `inverterKw`), keeping it unchanged for the meter
(`meterWattsToKw`), and backfilling every already-stored inverter `DeviceTelemetry.activePower` row
by recomputing it directly from that row's own preserved `rawPayload` (no re-fetch from Huawei
needed — the raw truth was never lost, only mis-scaled on the way into the typed column).

### What was deliberately not re-opened

This does not touch §9-§12's conclusions about the configuration endpoint (`20609`),
`inverter_state`'s enumeration, or the SDongle failure (`20013`) — those remain the canonical
baseline. It also does not change `activeEnergy`/`reverseActiveEnergy`'s counter semantics (ADR-007,
`energy-metrics.ts`'s own doc comment) — that was a labeling bug (export vs import), a completely
independent finding from this one (a scale bug).

---

# Next investigation

Future work on this topic should focus **only** on understanding why the documented configuration
endpoint (`/v1/configuration/active-power-control-mode`) returns `failCode 20609` for this plant.
Do not continue investigating telemetry endpoints (`getDevRealKpi`, `getStationRealKpi`) unless
genuinely new evidence appears — their capability boundary is considered fully and authoritatively
established (§9). The most direct paths to resolving the `20609` question, not yet exhausted:
retrieving the content of Huawei's dedicated FAQ on this exact failure (confirmed to exist by
title, unreachable via this environment's tooling), or contacting Huawei's inverter support
channel directly.

## 12. Rules for future work

Unless explicitly reopened by the user:

- Do not search Huawei documentation again on this topic.
- Do not propose alternative APIs.
- Do not revisit previously disproven hypotheses unless new evidence becomes available (e.g.,
  that `getDevRealKpi`/`getStationRealKpi` might expose control state, or that the `STATE_CODES_1`
  community bitmask table applies to `inverter_state`).

This document is the canonical baseline for future work on this topic. Build on the documented
facts recorded here rather than repeating this investigation.
