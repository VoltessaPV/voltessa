# Scaleway Production Infrastructure — Operator Runbook

Status: living document, and the **single source of truth** for this infrastructure. Future
sessions must read this instead of reconstructing VM/gateway/scheduler knowledge from chat history.
Update it whenever a service, timer, allow-listed endpoint, or SOP step changes.

For the historical "why" behind each piece of this infrastructure (root causes investigated, bugs
fixed, alternatives rejected), see `docs/research/telemetry-platform-foundation.md` §8 and
`docs/research/entsoe-price-scheduler.md` — this document intentionally does not repeat that
narrative. It documents the current operational state: what exists, where it lives, and how to
operate and debug it.

---

# Overview

Voltessa's production deployment spans three separate pieces of infrastructure:

- **Vercel** hosts the Next.js application (`apps/web`) — the actual product: all UI, server
  actions, and API routes, including the `app/api/internal/**` endpoints the Scaleway timers call
  into.
- **PostgreSQL** is managed separately from both Vercel and the Scaleway VM — reached via
  `DATABASE_URL`. No further host/provider detail is confirmed anywhere in this repo; don't assume
  one.
- **A dedicated Scaleway VM**, hostname `voltessa-fusionsolar-proxy`, IP `51.15.103.175`, hosts all
  background infrastructure that Vercel cannot or should not run directly.

See `CLAUDE.md`'s "Architecture" section and ADR-004/ADR-008/ADR-009 in
`docs/ARCHITECT_DECISIONS.md` for why this split exists (Vercel Cron was tried for scheduling and
reverted — see commits `6643255`/`853893d`; FusionSolar API access needed a stable, allow-listable
egress point and centralized secret handling in front of Huawei's API).

## Responsibility of this VM

**Known documentation gap, not addressed by this update**: `voltessa-automation-service` (the
standalone Playwright/browser-automation process for the Atlanta plant — see `automation/` at the
repo root and CLAUDE.md's "Automation Service" section) also runs on this VM as its own systemd
service, but was never added to this document when it was deployed. Flagging it here rather than
silently leaving it undocumented; fully documenting it is separate future work.

Eight independent `systemd` units run on it (plus the undocumented one above):

1. **`voltessa-fusionsolar-proxy.service`** — the FusionSolar gateway proxy. The only thing in the
   entire system allowed to call Huawei's FusionSolar API directly. `apps/web` never calls Huawei
   directly; it always goes through this gateway via `FUSIONSOLAR_GATEWAY_URL` +
   `FUSIONSOLAR_GATEWAY_SECRET` (`apps/web/lib/fusionsolar/api-client.ts`). This is the only unit
   that runs real integration logic on this VM — see "Huawei Gateway" below.
2. **`voltessa-telemetry-ingestion.timer`** — fires every 15 minutes, daily 06:00-22:00
   Europe/Sofia, calls back into Vercel to ingest `DeviceTelemetry`. See "Systemd Timers" below.
3. **`voltessa-market-price-scheduler.timer`** — fires once daily, calls back into Vercel to import
   ENTSO-E day-ahead prices. See "Systemd Timers" below.
4. **`voltessa-automation-execution.timer`** — fires every 15 minutes, calls back into Vercel to run
   one Market Price Optimization Execution Engine cycle. See "Systemd Timers" below.
5. **`voltessa-automation-reconciliation.timer`** — fires once daily at 06:00 Europe/Sofia, calls
   back into Vercel to reconcile Voltessa's stored automation state against FusionSolar's real
   state. See "Systemd Timers" below.
6. **`voltessa-forecast-refresh.timer`** — fires twice daily, 00:10 and 12:10 Europe/Sofia, calls
   back into Vercel to reconcile+regenerate the persisted PV forecast (`PvForecastRecord`). See
   "Systemd Timers" below.
7. **`voltessa-ml-forecast-refresh.timer`** — fires twice daily, 00:15 and 12:15 Europe/Sofia (5
   minutes after the physical refresh above), calls back into Vercel to reconcile+generate the ML
   self-learning forecast (`MlForecastRecord`). Previously undocumented here despite already
   running in production — closed by the Continuous Retraining Loop milestone's documentation pass.
   See "Systemd Timers" below.
8. **`voltessa-ml-retrain.timer`** — fires weekly, Monday 03:00 Europe/Sofia. The ONLY unit on this
   VM that runs real, CPU-bound work locally (`python3 train.py`) rather than purely relaying to
   Vercel — the same reason the ONNX Inference Service also lives on this VM instead of Vercel. See
   "Systemd Timers" below for the full three-hop flow.

Timers 2–7 only trigger HTTPS calls into the Vercel-hosted app (`CRON_SECRET`-guarded); none of them
run Huawei/business logic itself — all of that lives in `apps/web`. Timer 8 additionally runs a
local Python training step between two such HTTPS calls (see below). They are deliberately
independent units (separate service files, separate env files) so that a failure or change to one
can never affect the others, even though they currently share the same underlying `CRON_SECRET`
value (per ADR-008, every `app/api/internal/**` route shares one secret).

---

# Hardware Specification & Cost Investigation

**Status: partially verified — do not treat the cost conclusion as settled.**

A prior session's direct SSH inspection reportedly found this VM (`voltessa-fusionsolar-proxy`,
`51.15.103.175`) to be a Scaleway **BASIC3-X2C-4G** instance — 2 vCPU, 4 GB RAM, region **`nl-ams-1`**
(Amsterdam), roughly 8 GB disk — running all eight `systemd` units listed above plus the ONNX
Inference Service and the standalone Automation Service, at approximately **450 MB steady-state RSS**
with no obviously over-sized process. This document did not previously record any hardware/region
specification at all; it is captured here now, sourced from that prior inspection, not
independently re-verified via a fresh SSH session as part of this documentation sync. Before relying
on the exact instance type/region for a cost or capacity decision, re-confirm with
`scw instance server list` / the Scaleway console, or a fresh `ssh root@51.15.103.175` inspection
(`nproc`, `free -h`, `df -h`) — treat the numbers above as **INFERRED**, not **VERIFIED**, until then.

**The reported >€40/month Scaleway spend is NOT explained by this VM's own resource usage.** A
~450 MB RSS / 2 vCPU / 4 GB workload on a single BASIC3-X2C-4G instance does not, on its own, obviously
account for that spend at Scaleway's published list pricing for this instance class — but no billing-
console analysis has been performed to confirm what actually does. Do not guess at or invent an
explanation (extra volumes/snapshots, bandwidth egress, a second instance, account-level charges,
Object Storage, a Kubernetes/managed-database add-on, etc. are all *possible*, none of them
*confirmed*). **The concrete next step, not yet done, is a direct Scaleway billing-console review**
(Billing → Invoices/Usage breakdown, or `scw billing consumption list` if the CLI is available) to
itemize what is actually being charged, before proposing any migration or resizing "to save cost" —
per the standing instruction that infrastructure changes for cost reasons must be evidence-driven, not
assumption-driven. If a future session performs that billing review, record the itemized findings
here (replacing this paragraph), not in chat history alone.

---

# SSH Access

```
ssh root@51.15.103.175
```

After login, confirm you're on the right box:

```
hostname
```

should return:

```
voltessa-fusionsolar-proxy
```

---

# Systemd Services

## `voltessa-fusionsolar-proxy.service`

Purpose: the FusionSolar gateway proxy. Receives `{ path, body }` requests from `apps/web`
(authenticated via `x-gateway-secret`), checks the requested `path` against an allow-list, and — if
allowed — forwards the request to Huawei's FusionSolar API and relays the response back.

- **WorkingDirectory**: `/opt/voltessa-fusionsolar-proxy`
- **ExecStart**: starts `server.js` from that working directory. The exact interpreter/flags in the
  unit file have not been independently pasted into this document — run `systemctl cat`, below, to
  see them before assuming a specific invocation.
- **EnvironmentFile**: `/etc/voltessa-fusionsolar-proxy.env` (the proxy's own secrets/config — not
  the same file as `apps/web`'s Vercel env vars, and not committed anywhere; root-only).

Commands:

```
systemctl status voltessa-fusionsolar-proxy
systemctl cat voltessa-fusionsolar-proxy
systemctl restart voltessa-fusionsolar-proxy
journalctl -u voltessa-fusionsolar-proxy -f
```

---

# Systemd Timers

## `voltessa-telemetry-ingestion.timer`

**Live Telemetry Synchronization Redesign milestone**: cadence is every 15 minutes, daily
06:00-22:00 Europe/Sofia (previously hourly 06:00-22:00 plus a 23:58 close — both superseded by
this milestone; the 23:58 close-of-day run was dropped, since the remaining coverage gap
(22:00-06:00) is now backstopped by Dashboard/Market's own background recovery check the moment
anyone actually opens the app, rather than one more blind scheduled tick). The route this timer
calls does not synchronize anything itself — it delegates to the same shared synchronization
service Dashboard/Market's background recovery check also calls. See
`docs/research/telemetry-platform-foundation.md` §9 for the pre-redesign history.

```
voltessa-telemetry-ingestion.timer  (every 15 minutes, 06:00-22:00 Europe/Sofia)
  -> voltessa-telemetry-ingestion.service  (curl, Bearer CRON_SECRET)
  -> POST https://app.voltessa.ai/api/internal/fusionsolar/bootstrap-device-telemetry?days=1
  -> route.ts: crypto.timingSafeEqual auth check
  -> for every FusionSolarConnection:
       synchronizeFusionSolarConnection(connectionId)  (apps/web/lib/fusionsolar/telemetry-sync-service.ts)
         -> freshness check against FUSIONSOLAR_SYNC_FRESHNESS_MS (5 min) -- if fresh, skipped, no Huawei call
         -> otherwise: lease claim -> importDeviceTelemetry() + importPlantDailyKpi() -> Huawei
         -> DeviceTelemetry / PlantDailyKpi tables
  -> Dashboard / Market read directly from these tables on every render (Database-First
     Architecture milestone) -- this timer is the PRIMARY freshness mechanism; Dashboard/Market's
     own background ensureTelemetryFresh() call (mode: "background", non-blocking, fires after the
     response is already sent) is a RECOVERY-ONLY backstop for when this timer missed a cycle
     (scheduler/gateway/Huawei/network outage), never something the render waits on
```

- The `?days=1` query parameter is inert — the sync service's window is a fixed internal constant
  (`DAYS_BACK = 1`, "yesterday + today"). The systemd service's existing invocation does not need to
  change; the parameter is simply not read.
- **The scheduler is not special-cased** — it goes through the identical freshness gate as
  Dashboard/Market's own background recovery check (`synchronizeFusionSolarConnection(connectionId)`,
  no `force`). Since `FUSIONSOLAR_SYNC_FRESHNESS_MS` (5 min) is shorter than this timer's own
  15-minute cadence, a tick almost always performs a real sync; one that finds the connection
  already synced within 5 minutes (e.g. a user's page load triggered a recovery sync moments
  earlier) **correctly skips contacting Huawei** — expected, not a missed cycle. Only the manual
  Refresh action and deliberately-invoked diagnostics ever pass `force: true`.
- **EnvironmentFile**: `/etc/voltessa-telemetry-scheduler.env` (root-only, `chmod 600`) — holds this
  service's own `CRON_SECRET` copy. This is a **separate file** from the gateway's
  `/etc/voltessa-fusionsolar-proxy.env` — don't confuse them.
- Idempotent by design: the `(deviceId, timestamp, resolution)` unique constraint +
  `skipDuplicates: true` means overlapping 5-minute windows never double-insert — confirmed live by
  calling the endpoint twice in immediate succession (2nd call: 0 inserted, all duplicates
  correctly skipped).
- `CRON_SECRET` is a Vercel **Sensitive** variable — it cannot be read back in plaintext once set
  (`vercel env pull`/`env ls` will not recover the real value). If this scheduler starts failing
  with HTTP 401, the fix is to **rotate** `CRON_SECRET` in Vercel (Production + Preview), write the
  same new value into `/etc/voltessa-telemetry-scheduler.env`, then trigger a new Vercel production
  deploy (serverless functions read env vars from their own deployment snapshot, not a live store —
  a new secret will keep 401ing until the next deploy).

## `voltessa-market-price-scheduler.timer`

```
voltessa-market-price-scheduler.timer  (OnCalendar=*-*-* 14:00:00 Europe/Sofia — once daily)
  -> voltessa-market-price-scheduler.service
  -> ExecStart: /usr/local/bin/voltessa-market-price-poll.sh
       -> calls GET .../api/internal/market-price/refresh-prices?target=tomorrow (Bearer CRON_SECRET)
       -> parses the JSON response with jq (ok / unavailable / isPartial)
       -> complete import (ok && !unavailable && !isPartial): exit 0 immediately
       -> not yet published: sleep 1800s (30 min), retry — up to MAX_ATTEMPTS=16 (~8h headroom)
       -> exhausted all 16 attempts: non-zero exit (real failure, visible in journalctl)
```

- The retry/stop policy lives **entirely in the script**, not in `apps/web` — the importer
  (`refreshMarketPrices`) is a plain, single-attempt call; the script owns all polling/backoff
  decisions.
- **IBEX Fallback milestone (ADR-021)**: the route this script calls
  (`refresh-prices?target=tomorrow`) now internally falls back to IBEX (the Independent Bulgarian
  Energy Exchange) for the same delivery day whenever ENTSO-E fails/is unavailable/leaves the day
  partial — ENTSO-E remains PRIMARY. This is entirely inside `apps/web` (Vercel); **no change to this
  VM, this script, or this timer was needed**. A day completed via IBEX still reports as a normal
  success (`ok:true, isPartial:false`) in the script's own `jq`-parsed response — an operator tailing
  `journalctl` for this service will not see any indication of *which* provider actually supplied a
  given day from this script's output alone; check `MarketPriceImport.source` in the database, or
  Vercel's own runtime logs, if that distinction matters for a specific investigation. See
  `docs/research/entsoe-price-scheduler.md` §10 and ADR-021 in `docs/ARCHITECT_DECISIONS.md`.
- `TimeoutStartSec=infinity` is set on this unit — required, because the default 90s systemd
  timeout would otherwise kill a script that can legitimately run for hours across retries. If this
  is ever missing after an edit, retries after the first 90 seconds will silently stop working.
- `systemd` resolves the `Europe/Sofia` IANA zone (and its DST transitions) itself — no manual DST
  bookkeeping needed, and the host's own system timezone stays `Etc/UTC` throughout, unaffected.
- **Environment file**: not independently confirmed by exact filename in this document. Per §6 of
  `docs/research/entsoe-price-scheduler.md`, this scheduler has "a separate env file" from the
  telemetry one, following the same `/etc/voltessa-<service>.env` naming convention. Run
  `systemctl cat voltessa-market-price-scheduler` or `ls /etc/voltessa-*.env` on the VM to get the
  exact name before assuming it matches the pattern.

## `voltessa-automation-execution.timer`

Market Price Optimization Execution Engine milestone. See `apps/web/lib/automation/market-price-optimization-scheduler.ts`.

```
voltessa-automation-execution.timer  (OnCalendar=*:0/15 — every 15 minutes)
  -> voltessa-automation-execution.service  (curl, Bearer CRON_SECRET)
  -> POST https://app.voltessa.ai/api/internal/automation/execute-market-price-optimization
  -> route.ts: crypto.timingSafeEqual auth check
  -> runMarketPriceOptimizationScheduler():
       for every organization with AutomationSettings.automationEnabled=true AND owning a Plant
       named "Atlanta" (the Automation Service itself is hardcoded to Atlanta only):
         acquire this organization's per-org lock (AutomationState.isRunning) - already running?
           skip this cycle silently, no AutomationEvent created
         read current + next-interval MarketPrice, stored AutomationState.currentExportMode
         decideExportAction() (apps/web/lib/automation/export-decision.ts, pure function,
           ±5 EUR/MWh hysteresis band around the configured threshold)
         action NONE -> release lock, done, no AutomationEvent
         action requires a switch -> call the existing Automation Service
           (zero-export / no-limit, same endpoints app/dev/huawei-api already uses)
           success -> update AutomationState.currentExportMode, create a "mode_changed" AutomationEvent
           failure (thrown or {success:false}) -> keep previous stored state, create an
             "automation_service_failed" AutomationEvent
         release lock
```

- **Never queries FusionSolar directly** — reads only Voltessa's own stored `AutomationState`. The
  daily reconciliation timer below is the only job in this engine that reads FusionSolar's real
  state.
- **EnvironmentFile**: `/etc/voltessa-automation-execution.env` (root-only, `chmod 600`) — its own
  `CRON_SECRET` copy, separate file from the other three schedulers' env files, same convention.
- The per-organization lock lives on `AutomationState` itself (`isRunning`/`lockedAt`), not a
  dedicated lock table — see that model's doc comment in `prisma/schema.prisma`. Shared with
  `voltessa-automation-reconciliation.timer` below, so the two can never run concurrently for the
  same organization either.

## `voltessa-automation-reconciliation.timer`

Market Price Optimization Execution Engine milestone. See `apps/web/lib/automation/daily-reconciliation.ts`.

```
voltessa-automation-reconciliation.timer  (OnCalendar=*-*-* 06:00:00 Europe/Sofia — once daily)
  -> voltessa-automation-reconciliation.service  (curl, Bearer CRON_SECRET)
  -> POST https://app.voltessa.ai/api/internal/automation/daily-reconciliation
  -> route.ts: crypto.timingSafeEqual auth check
  -> runDailyReconciliation():
       for every organization owning a Plant named "Atlanta" (findAtlantaOrganizationIds) -
       deliberately NOT gated on AutomationSettings.automationEnabled, unlike the execution
       engine above: this job is read-only and only ever updates Voltessa's own stored
       AutomationState, so it stays safe to run even while automation is disabled - keeps
       AutomationState accurate for the moment it's turned back on:
         acquire the same per-org lock - already running? skip silently, no event
         call the Automation Service's Read Status operation (the one place in this whole
           engine that ever queries FusionSolar directly)
         all dongles agree on one mode, and it matches AutomationState.currentExportMode
           -> do nothing, no AutomationEvent
         dongles disagree with each other, or disagree with the stored state
           -> create a "reconciliation_mismatch" AutomationEvent
           -> if a single real FusionSolar mode was determined: update AutomationState to match it,
              create a "reconciliation_synced" AutomationEvent (Voltessa's record follows FusionSolar
              - this job never changes the plant itself)
         release lock
```

- **EnvironmentFile**: `/etc/voltessa-automation-reconciliation.env` (root-only, `chmod 600`).
- Exists to catch drift between Voltessa's stored state and reality — e.g. a manual mode change via
  `/dev/huawei-api` that the 15-minute engine was never told about.

## `voltessa-forecast-refresh.timer`

Dashboard Forecast Architecture Correction milestone. See
`apps/web/app/api/internal/forecast/refresh/route.ts`,
`apps/web/lib/forecast/pv-forecast-engine.ts`, `apps/web/lib/forecast/forecast-persistence.ts`.

```
voltessa-forecast-refresh.timer  (OnCalendar=00:10:00 and 12:10:00 Europe/Sofia — twice daily)
  -> voltessa-forecast-refresh.service  (curl, Bearer CRON_SECRET, --max-time 600)
  -> POST https://app.voltessa.ai/api/internal/forecast/refresh
  -> route.ts: crypto.timingSafeEqual auth check
  -> for every Plant with latitude/longitude/capacityKw configured:
       reconcileForecastActuals(plantId, organizationId)
         -> fills actualKwh/errorKwh/errorPct on previously-persisted, now-elapsed PvForecastRecord
            rows, from reconstructAvailablePv (never historical export)
       generatePvForecast({ ..., horizonHours: DEFAULT_EXTENDED_HORIZON_DAYS * 24 })
         -> the same physical/weather/calibration/analog/glide-path engine the Dashboard's Live
            Energy chart and Forecast card used to run inline, on every request, before this
            milestone
       persistFullForecastVintage(plantId, organizationId, forecast)
         -> writes every interval, every horizon tier (SHORT/MEDIUM/LONG), as one new
            PvForecastRecord vintage (never overwrites a prior vintage - see that model's own doc
            comment in prisma/schema.prisma)
  -> Dashboard reads ONLY the latest persisted vintage (lib/forecast/forecast-read.ts's
     getLatestForecastVintage - a couple of indexed SELECTs) on every render; it never calls
     generatePvForecast itself any more. This is what makes a normal Dashboard render fast
     regardless of forecasting.
```

- This is the ONLY place `generatePvForecast` runs in production — a genuinely expensive call
  (Open-Meteo fetch, plant-specific calibration lookback query, analog-day search, ~35 days x 96
  intervals/day x however many plants are configured). Previously this ran inline on every
  Dashboard request (opportunistically throttled to roughly hourly); this milestone moved it here
  entirely, following the exact same "scheduled timer calls back into Vercel" pattern the other
  five units already use.
- **EnvironmentFile**: `/etc/voltessa-forecast-refresh.env` (root-only, `chmod 600`) — its own
  `CRON_SECRET` copy, same convention as every other scheduler's env file.
- `--max-time 600` (vs. the other schedulers' shorter timeouts) because a full-horizon forecast for
  every configured plant, sequentially, can genuinely take longer than a single telemetry-ingestion
  tick — if this unit starts timing out as more plants are added, raise this value rather than
  parallelizing plant processing (deliberately sequential for now, matching this codebase's
  "simplicity over cleverness" principle at the current 2-plant scale).
- One plant's failure never blocks another's — `route.ts` wraps each plant independently and
  reports `ok: true` only if every plant succeeded; a partial failure still persists whichever
  plants did succeed.

## `voltessa-ml-forecast-refresh.timer`

Multi-Horizon Self-Learning Forecast milestone. Previously undocumented here despite already
running in production since that milestone shipped — closed by the Continuous Retraining Loop
milestone's documentation pass (also see that route's own doc comment, which used to incorrectly
say this timer didn't exist yet). See `apps/web/app/api/internal/forecast/ml-refresh/route.ts`,
`apps/web/lib/forecast/ml/ml-persistence.ts`.

```
voltessa-ml-forecast-refresh.timer  (OnCalendar=00:15:00 and 12:15:00 Europe/Sofia — twice daily,
                                      5 minutes after voltessa-forecast-refresh.timer)
  -> voltessa-ml-forecast-refresh.service  (curl, Bearer CRON_SECRET, --max-time 600)
  -> POST https://app.voltessa.ai/api/internal/forecast/ml-refresh
  -> route.ts: crypto.timingSafeEqual auth check
  -> for every Plant with latitude/longitude/capacityKw configured:
       reconcileMlForecastActuals(plantId, organizationId)
         -> fills actualKwh/errorKwh/errorPct on previously-persisted, now-elapsed MlForecastRecord
            rows, from reconstructAvailablePv (same source the physical pipeline's own
            reconciliation uses)
       persistMlForecast({ ..., issuedAt })
         -> generateMlForecast(): loads the current CHAMPION's two ONNX artifacts
            (ForecastModelVersion), recomputes the physical baseline + features locally, delegates
            only the ONNX inference call itself to the ONNX Inference Service (below)
         -> writes MlForecastRecord — entirely separate from PvForecastRecord; the Dashboard never
            reads this table (see CLAUDE.md's "Dashboard Forecast" area and ADR context — this is
            deliberate, not yet wired in)
```

- **EnvironmentFile**: `/etc/voltessa-ml-forecast-refresh.env` (root-only, `chmod 600`) — its own
  `CRON_SECRET` copy, same convention as every other scheduler's env file.
- Feeds the ONNX Inference Service (`fusionsolar-gateway.voltessa.ai/onnx-inference` ->
  `127.0.0.1:4200`, `/opt/voltessa-onnx-inference` on this same VM) for the actual model inference
  call — `onnxruntime-node`'s native binary does not load in Vercel's serverless runtime (confirmed
  in production), the same reasoning behind `voltessa-ml-retrain.timer` below.
- Read-only monitoring: `/admin/ml-forecast` in the app (current champion, model version history,
  retraining eligibility, live trailing-window accuracy per plant/horizon-tier).

## `voltessa-ml-retrain.timer`

Continuous Retraining Loop milestone. See `apps/web/lib/forecast/ml/genuine-vintage.ts`,
`apps/web/lib/forecast/ml/build-training-dataset.ts`,
`apps/web/app/api/internal/forecast/ml-retrain-export/route.ts`,
`apps/web/app/api/internal/forecast/ml-retrain-promote/route.ts`, `ml-forecasting/train.py`
(unmodified), `ml-forecasting/retrain.sh`.

```
voltessa-ml-retrain.timer  (OnCalendar=Mon *-*-* 03:00:00 Europe/Sofia — weekly)
  -> voltessa-ml-retrain.service  (oneshot, TimeoutStartSec=1800)
  -> /opt/voltessa-ml-retrain/retrain.sh:
       1. GET https://app.voltessa.ai/api/internal/forecast/ml-retrain-export
            (Bearer CRON_SECRET) - route.ts checks how many NEW genuine TRUE_VINTAGE days exist
            per plant since the current champion's own trainingDataEnd (findGenuineVintageDays,
            shouldRetrain - conservative, default minimum 5 combined across all plants). If not
            eligible: returns { eligible: false } and the script exits 0 immediately - no dataset
            built, no training run, no ForecastModelVersion row created. If eligible: builds and
            returns the FULL walk-forward training dataset (buildTrainingDataset - the same
            function scripts/ml/export-training-dataset.ts uses for a local/manual run) in the
            response body.
       2. python3 train.py  (local, this VM, unmodified) - CPU-only, walk-forward validated,
            head-to-head LightGBM/XGBoost, writes magnitude_model.onnx, shape_model.onnx,
            model-manifest.json to ./data/. Runs off Vercel because it's CPU-bound Python, not
            something a serverless function can do - the exact same reason the ONNX Inference
            Service itself runs on this VM instead of Vercel.
       3. POST https://app.voltessa.ai/api/internal/forecast/ml-retrain-promote
            (Bearer CRON_SECRET, manifest + both ONNX files base64-encoded in the JSON body)
            -> route.ts: registerCandidate() - a new ForecastModelVersion, status CANDIDATE,
               NEVER CHAMPION - then evaluateAndPromote() - the existing champion/challenger gate
               (lib/forecast/ml/promotion.ts, unmodified). Promotes only if every check passes;
               otherwise marks the candidate REJECTED with its reason and leaves the current
               champion untouched.
  -> a SchedulerRun row ("ml_retrain") is recorded either way - by ml-retrain-export itself if the
     cycle was skipped (not eligible), by ml-retrain-promote if training actually ran.
```

- **Why this VM, not Vercel, for the training step specifically**: `train.py` needs a real Python
  runtime and sustained CPU time; Vercel's serverless functions cannot provide either. Steps 1 and 3
  run on Vercel (which already has this app's full Prisma/Next.js dependency tree deployed) —
  only the one step that structurally cannot run there (step 2) runs locally on this VM.
- **Why NOT a full monorepo checkout on this VM**: this VM's disk is small (8GB total, ~2-3GB
  typically free) and already hosts the FusionSolar gateway — a full `pnpm install` of this
  Next.js/Prisma monorepo alongside Python's ML libraries (numpy/pandas/lightgbm/xgboost/onnx/
  onnxmltools/skl2onnx/onnxruntime/scikit-learn, confirmed ~600MB installed) was judged too risky
  for the available headroom. `/opt/voltessa-ml-retrain/` therefore contains only `train.py`,
  `requirements.txt`, `retrain.sh`, and a Python venv — no Node, no pnpm, no monorepo checkout.
- **Python setup on this VM**: `python3.12-venv` and `libgomp1` (LightGBM's OpenMP runtime
  dependency) were installed via `apt` as prerequisites — neither existed on this VM before. The
  venv lives at `/opt/voltessa-ml-retrain/venv`; `pip install -r requirements.txt` pulled in
  `nvidia-nccl-cu13` (~250MB, GPU-only, irrelevant on this CPU-only box) as a transitive XGBoost
  dependency — uninstalled immediately after install, confirmed all imports (`xgboost`, `lightgbm`,
  `onnxmltools`, `pandas`, `numpy`) still work without it.
- **EnvironmentFile**: `/etc/voltessa-ml-retrain.env` (root-only, `chmod 600`) — its own
  `CRON_SECRET` copy (same value as every other scheduler's, copied directly between env files, per
  ADR-008), same convention as every other scheduler's env file.
- **Conservative by design**: the eligibility check (step 1) means most weekly firings are expected
  to be a no-op for a while — retraining only actually happens once enough new genuine vintage data
  has accumulated. This is intentional, not a bug to "fix" by lowering the threshold — see
  `lib/forecast/ml/genuine-vintage.ts`'s own doc comments for the full reasoning.
- **A training run can never become champion by merely completing** — `evaluateAndPromote` is the
  only path to CHAMPION status; a candidate that fails the gate is marked REJECTED and the current
  champion is untouched. No manual promotion step exists or is needed.
- **Read-only monitoring**: `/admin/ml-forecast` shows retraining eligibility (the exact same check
  this timer runs), model version history including CANDIDATE/REJECTED entries with rejection
  reasons, and live trailing-window accuracy per plant/horizon-tier — independent of, and more
  recent than, any single champion's own training-time holdout metrics.

Commands:

```
systemctl list-timers
systemctl status voltessa-telemetry-ingestion.timer
systemctl status voltessa-market-price-scheduler.timer
systemctl status voltessa-automation-execution.timer
systemctl status voltessa-automation-reconciliation.timer
systemctl status voltessa-forecast-refresh.timer
systemctl status voltessa-ml-forecast-refresh.timer
systemctl status voltessa-ml-retrain.timer
journalctl -u voltessa-telemetry-ingestion.service -f
journalctl -u voltessa-market-price-scheduler.service -f
journalctl -u voltessa-automation-execution.service -f
journalctl -u voltessa-forecast-refresh.service -f
journalctl -u voltessa-automation-reconciliation.service -f
journalctl -u voltessa-ml-forecast-refresh.service -f
journalctl -u voltessa-ml-retrain.service -f
systemd-analyze calendar '*-*-* 14:00:00 Europe/Sofia'   # check what a timer's OnCalendar actually resolves to
```

---

# Huawei Gateway

## Purpose

The only component in the entire system permitted to call Huawei's FusionSolar API directly.
Centralizes the Huawei OAuth Bearer token forwarding and Huawei API secret handling behind one
stable, allow-listable egress point (ADR-004) — `apps/web` never talks to Huawei's API host
directly, from any route, action, or script.

## Architecture

Runs as `voltessa-fusionsolar-proxy.service` — working directory, entry point, dependencies, and
environment file are documented once, under "Systemd Services" above, not repeated here.

## Request flow

```
Voltessa (apps/web, Vercel)
    │  POST {FUSIONSOLAR_GATEWAY_URL}/v1/fusionsolar/api
    │  headers: Authorization: Bearer <Huawei OAuth token>, x-gateway-secret: <FUSIONSOLAR_GATEWAY_SECRET>
    │  body: { path, body }
    ▼
Gateway (voltessa-fusionsolar-proxy.service, this VM)
    │  checks `path` against FUSIONSOLAR_ALLOWED_API_PATHS
    │  not allowed -> rejects locally, responds { ok: false, error: "api_path_not_allowed" }
    │  allowed -> forwards `body` to Huawei's FusionSolar API host, relays the real response back
    ▼
Huawei FusionSolar (SmartPVMS Northbound API)
```

## Allow-list mechanism

`server.js` contains `FUSIONSOLAR_ALLOWED_API_PATHS` — an allow-list of Huawei API paths the gateway
will forward. **Every new Huawei endpoint must be added here before it can ever reach Huawei.**
Adding a new `lib/fusionsolar/*.ts` call in `apps/web` is necessary but not sufficient — if the path
isn't in this list, the gateway rejects the request locally and Huawei never sees it.

## Meaning of `api_path_not_allowed`

```
{ "ok": false, "error": "api_path_not_allowed" }
```

means **the request never left the proxy** — rejected locally, before ever being forwarded to
Huawei. This is the single most useful fact in this document for debugging FusionSolar issues: do
**not** interpret this as a Huawei-side error, an OAuth scope problem, or a request-body problem.
None of those produce this exact response shape (Huawei's own responses use
`{ success, failCode, message, data }`, confirmed against the official SmartPVMS Northbound API
Reference — a completely different envelope). A missing allow-list entry is the explanation that
fits, every time.

## How new Huawei endpoints are added

1. Implement the call in `apps/web/lib/fusionsolar/*.ts` as normal (this alone will not work yet).
2. SSH into the VM, follow the SOP below to add the new path string to
   `FUSIONSOLAR_ALLOWED_API_PATHS` in `server.js`.
3. Restart the gateway (`systemctl restart voltessa-fusionsolar-proxy`).
4. Retry the real call from Voltessa and confirm in the tailed logs (next section) that it now
   reaches Huawei.

## How to verify a path reaches Huawei

```
grep -n "FUSIONSOLAR_ALLOWED_API_PATHS" -A 20 /opt/voltessa-fusionsolar-proxy/server.js
```

Check whether the exact path (e.g.
`/rest/openapi/pvms/nbi/v2/control/active-power-control/async-task`) is present. Then, with
`journalctl -u voltessa-fusionsolar-proxy -f` running, trigger the real request from Voltessa and
confirm the log shows an outbound call to Huawei's host and a real Huawei-shaped response
(`success`/`failCode`/`message`/`data`), not a local rejection.

## How to debug a failed request

See "Production Debugging Checklist" below for the full step-by-step version. In short: tail the
gateway's logs while retriggering the request — if you see `api_path_not_allowed`, it's the
allow-list (above). If you see a real Huawei response with `success: false`, the request reached
Huawei and the problem is Huawei-side (auth scope, request shape, account/plant topology) — a
different debugging path, not a gateway problem, and not something a gateway config change can fix.

---

# Engineering diagnostics

## `scripts/diagnostics/huawei-control.ts`

A CLI that invokes the real, production Huawei Control implementation
(`apps/web/lib/fusionsolar/huawei-control-service.ts`'s `setZeroExport`/`setNoLimit`) directly,
without going through the "Huawei Control (Testing)" UI card's NextAuth-gated server action
(`app/(platform)/automations/actions.ts`). It exists because that server action is deliberately
manual/session-only (see the "Deliberately manual-only" comment in `huawei-control-service.ts`) —
there is no `CRON_SECRET`-style bypass for it, and none should be added. Before this script, the
only way to exercise that code path was clicking the button in a real browser session.

The script does not reimplement any Huawei/control logic. It:

1. Resolves a Huawei plant (and its `organizationId`) from a `--plant` name — the one thing that
   necessarily differs from the server action, which starts from a session's `organizationId`
   instead. Same constraints as `findOrgHuaweiPlantId`/`findControllablePlant`
   (`vendor: "Huawei"`, `plantCode` set), just keyed by name.
2. Calls the existing, unmodified `setZeroExport`/`setNoLimit`, which loads the
   `FusionSolarConnection`, builds the request, and dispatches it through
   `export-control.ts` → `api-client.ts` → the FusionSolar gateway → Huawei — identical to the UI
   path.

All request/response/`failCode`/`message`/`taskId`/`result[]`/duration logging comes from that
file's own `logDetail()` calls (unmodified) — the script does not duplicate or reformat any of it,
it just lets that logging print to its own stdout/stderr since it runs in a plain Node process.

Usage (from the repo root):

```
pnpm tsx --tsconfig apps/web/tsconfig.json scripts/diagnostics/huawei-control.ts --plant Atlanta --mode zero-export
pnpm tsx --tsconfig apps/web/tsconfig.json scripts/diagnostics/huawei-control.ts --plant Atlanta --mode no-limit
```

The `--tsconfig apps/web/tsconfig.json` flag is required — `huawei-control-service.ts` and the
files it imports use the `@/*` path alias defined in `apps/web/tsconfig.json`, and `tsx` does not
discover that automatically when the entry script lives outside `apps/web`.

The script loads `apps/web/.env.local` (falling back to `apps/web/.env`) itself, mirroring
Next.js's own precedence, since a standalone script has no framework doing this automatically.
Confirmed in this environment: local `DATABASE_URL` is a real, working connection to production
Postgres (resolves real plants/organizations), but `FUSIONSOLAR_GATEWAY_URL`/
`FUSIONSOLAR_GATEWAY_SECRET` are not set locally by design (same local-dev gap `AI_PLAYBOOK.md`
already documents for gateway-dependent code) — so a local run reaches the real dispatch call and
fails there with `FusionSolar gateway environment variables are not configured`, rather than
silently no-op'ing or hitting Huawei. Completing a live run therefore needs those two values from
somewhere with real access to them (e.g. the VM's `/etc/voltessa-fusionsolar-proxy.env` for the
gateway secret) — treat supplying them the same as any other live control command: confirm with
the user first, since a successful `zero-export` call has direct, real financial consequences for
the plant it targets (see `CLAUDE.md`, `docs/AI_PLAYBOOK.md`).

**Engineering diagnostics only** — never called by production users, never scheduled, never wired
into automation or a route. Prefer this script over manual UI clicks for all future Huawei Control
experiments; it produces the same complete, structured log output every time instead of relying on
someone reading the Vercel dashboard live.

---

# Production Debugging Checklist

## Huawei gateway issues

1. SSH into the VM (`ssh root@51.15.103.175`).
2. Check service health (`systemctl status voltessa-fusionsolar-proxy`).
3. Tail logs (`journalctl -u voltessa-fusionsolar-proxy -f`) — leave this running.
4. Verify the endpoint exists in the allow-list (`grep` `server.js` for
   `FUSIONSOLAR_ALLOWED_API_PATHS`, per "Huawei Gateway" above).
5. If the allow-list needed a change, follow the SOP below (inspect → explain → backup → modify →
   restart → verify) — restart the service after any change.
6. Retry the action from Voltessa (trigger the real button/flow that calls the gateway).
7. Inspect the upstream Huawei response in the tailed log — confirm the request actually reached
   Huawei this time, and read whatever Huawei returned (HTTP status, `failCode`, `message`).

## Telemetry ingestion issues (Dashboard/Market showing stale data)

1. `systemctl status voltessa-telemetry-ingestion.timer` — confirm it's `active (waiting)`, not
   disabled/failed.
2. `systemctl list-timers` — confirm the "next" fire time is within 15 minutes of now during
   06:00-22:00 Europe/Sofia (outside that window, the next fire time is the following day's 06:00 —
   not stalled, by design; see Dashboard/Market's background recovery check for what covers that gap).
3. `journalctl -u voltessa-telemetry-ingestion.service --since "15 min ago"` — check the last few
   runs. Since ADR-011 (Database-First Telemetry Architecture), the response is `ok:true` with a
   `results` array, one entry per `FusionSolarConnection`, each carrying a `status`:
   `"synced"` (a real sync ran — includes samples fetched/inserted/duplicates),
   `"skipped_fresh"` (the connection was already synced within `FUSIONSOLAR_SYNC_FRESHNESS_MS` —
   **expected, not an error**, e.g. a Dashboard/Market visit already refreshed it moments earlier),
   `"skipped_already_running"` (another request's sync was already in flight for that connection),
   or `"failed"` (a genuine error, with `reason`).
4. **HTTP 401** in the logs → `CRON_SECRET` mismatch. Rotate it (see "Systemd Timers" above) — the
   old value cannot be read back, only replaced.
5. **HTTP 200 but stale data anyway** → first check whether every connection's entry actually says
   `"skipped_fresh"`/`"synced"` rather than `"failed"`. If `"failed"`, tail
   `journalctl -u voltessa-fusionsolar-proxy` for the same window — a sync failure is almost always a
   downstream gateway problem (see "Huawei gateway issues" above), not a scheduler problem, since
   `telemetry-sync-service.ts` never throws for its own reasons. If every connection shows `"synced"`
   with real sample counts but Dashboard/Market still look stale, confirm the route being hit is
   still `bootstrap-device-telemetry` (writes `DeviceTelemetry`/`PlantDailyKpi`, what Dashboard/Market
   read) and not the legacy `ingest-plant-telemetry` route (writes the unrelated
   `PlantTelemetrySnapshot` table — confirmed dormant, not scheduled by anything, per
   `docs/research/telemetry-platform-foundation.md` §8.2).
6. If the gateway itself is down, telemetry ingestion will fail too (it calls Huawei through the
   same gateway) — check gateway health first if telemetry errors mention FusionSolar/Huawei rather
   than the Vercel endpoint itself.

## ENTSO-E scheduler issues (Market prices missing/stale)

1. `systemctl status voltessa-market-price-scheduler.timer` — confirm `active (waiting)`.
2. `systemctl list-timers` — next fire time should be `14:00 Europe/Sofia` (resolves to `11:00 UTC`
   in summer/EEST, `12:00 UTC` in winter/EET — verify with `systemd-analyze calendar` if unsure
   which applies right now).
3. `journalctl -u voltessa-market-price-scheduler.service --since "today"` — the script logs each
   attempt (`Attempt N/16`), the parsed response (`ok`/`unavailable`/`isPartial`), and either
   `Complete next-day dataset imported - stopping retries` (success) or repeated
   `Sleeping 1800s before retry` lines.
4. **Exit code non-zero after 16 attempts** → real failure — ENTSO-E may not have published on
   schedule, or `ENTSOE_API_TOKEN` may be misconfigured in Vercel production (this has happened
   before — it was declared in `turbo.json` but never actually set as a real Vercel value; see
   `docs/research/entsoe-price-scheduler.md` §2.2). Check Vercel env vars for that org/token, not
   just the scheduler.
5. **Stuck retrying past the normal window** → a manual test run left the unit in a bad state; use
   `systemctl stop voltessa-market-price-scheduler.service` then `systemctl reset-failed` to clear
   it before the next real trigger, rather than leaving it to fight with tomorrow's run.
6. `CRON_SECRET` issues are diagnosed and fixed the same way as the telemetry scheduler — same
   secret value, separate env file (exact filename not yet confirmed — see "Systemd Timers" above).

---

# Common Commands

```
# Services
systemctl status voltessa-fusionsolar-proxy
systemctl restart voltessa-fusionsolar-proxy
systemctl cat voltessa-fusionsolar-proxy

# Timers
systemctl list-timers
systemctl status voltessa-telemetry-ingestion.timer
systemctl status voltessa-market-price-scheduler.timer
systemctl status voltessa-forecast-refresh.timer
systemctl status voltessa-ml-forecast-refresh.timer
systemctl status voltessa-ml-retrain.timer
systemd-analyze calendar '*-*-* 14:00:00 Europe/Sofia'

# Logs
journalctl -u voltessa-fusionsolar-proxy -f
journalctl -u voltessa-fusionsolar-proxy --since "10 min ago"
journalctl -u voltessa-telemetry-ingestion.service --since "15 min ago"
journalctl -u voltessa-market-price-scheduler.service --since "today"
journalctl -u voltessa-forecast-refresh.service --since "today"
journalctl -u voltessa-ml-forecast-refresh.service --since "today"
journalctl -u voltessa-ml-retrain.service --since "today"

# Inspecting source/config
cat /opt/voltessa-fusionsolar-proxy/server.js
cat /opt/voltessa-fusionsolar-proxy/package.json
cat /etc/voltessa-fusionsolar-proxy.env
cat /etc/voltessa-telemetry-scheduler.env
cat /usr/local/bin/voltessa-market-price-poll.sh
cat /opt/voltessa-ml-retrain/retrain.sh
ls /etc/voltessa-*.env

# Searching
grep -n "FUSIONSOLAR_ALLOWED_API_PATHS" -A 20 /opt/voltessa-fusionsolar-proxy/server.js
grep -rn "<search term>" /opt/voltessa-fusionsolar-proxy/

# Recovering a stuck scheduler run
systemctl stop voltessa-market-price-scheduler.service
systemctl reset-failed voltessa-market-price-scheduler.service

# Editing (see SOP below before using these on anything but a backup)
cp server.js server.js.bak.$(date +%Y%m%d-%H%M%S)   # always back up first
```

---

# Standard Operating Procedure — mandatory for any change to this VM

This applies to any future Claude session (or human) making a change on this VM — not to read-only
inspection, which is always fine. **Never edit production blindly. This order is mandatory, every
time, with no steps skipped:**

1. **Inspect** — read the current state before touching anything: `systemctl status`,
   `systemctl cat`, `cat`/`grep` the relevant file(s), `journalctl` for recent behavior. Understand
   what's actually there, not what you assume is there.
2. **Explain** — state plainly, before editing, what you're about to change and why, referencing
   what step 1 found. If you're a Claude session, say this to the user explicitly and get
   confirmation before proceeding — this is production infrastructure with real, live financial
   consequences (see `CLAUDE.md`, `docs/AI_PLAYBOOK.md`).
3. **Backup** — copy the file you're about to edit before editing it
   (`cp server.js server.js.bak.$(date +%Y%m%d-%H%M%S)`). Never edit in place without a backup you
   could restore from in seconds.
4. **Modify** — make the smallest change that addresses what step 2 described. Don't bundle
   unrelated cleanup into a production infrastructure edit.
5. **Restart** — apply the change (`systemctl restart <unit>`). Config and code changes to a
   running service don't take effect until restarted.
6. **Verify** — tail logs (`journalctl -u <unit> -f`) while retriggering the real flow that
   exercises the change, and confirm actual behavior matches what step 2 said it would. Don't
   consider the change done until you've watched it work.

If any step reveals something unexpected (the file doesn't look like you expected, the service
doesn't restart cleanly, logs show something unrelated breaking) — stop, go back to Inspect, and
re-explain before continuing. Don't push through surprises on production infrastructure.

Future Claude sessions should be able to do all of the following on this VM, always through this
SOP: SSH in, locate every production service, read production files, modify production files
**when explicitly requested**, restart services, inspect logs, and verify the result. Modifying
production files without an explicit request from the user is out of scope regardless of how
confident the diagnosis is — per `CLAUDE.md`'s autonomous-execution rules, this class of change is
one of the few that must stop and ask, not proceed independently.

---

# Future Changes — rules that don't expire

- **Never bypass the gateway.** `apps/web` must never call Huawei's API directly, from any route,
  action, or script — always through `FUSIONSOLAR_GATEWAY_URL`/`callFusionSolarApi`.
- **Never call Huawei directly from Vercel.** Same rule stated from the other side — no serverless
  function should hold a direct HTTPS client to Huawei's FusionSolar API host.
- **Every new Huawei endpoint requires updating the allow-list** in `server.js`
  (`FUSIONSOLAR_ALLOWED_API_PATHS`) on this VM before the corresponding `lib/fusionsolar/*.ts` code
  in `apps/web` can ever succeed against it. Writing the Voltessa-side code first and updating the
  allow-list after is fine; expect `api_path_not_allowed` until the allow-list is updated to match.
- **Restart the affected unit after any change** to its source/config — `server.js`,
  `voltessa-market-price-poll.sh`, or any `/etc/voltessa-*.env` file. Changes do not take effect
  until the unit is restarted.
- **Validate with `journalctl` while testing**, every time — don't assume a restart + retry worked
  without watching the logs confirm it.
- **Follow the SOP above exactly** for every change — no exceptions for "small" edits.
