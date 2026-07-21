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

Three independent `systemd` units run on it:

1. **`voltessa-fusionsolar-proxy.service`** — the FusionSolar gateway proxy. The only thing in the
   entire system allowed to call Huawei's FusionSolar API directly. `apps/web` never calls Huawei
   directly; it always goes through this gateway via `FUSIONSOLAR_GATEWAY_URL` +
   `FUSIONSOLAR_GATEWAY_SECRET` (`apps/web/lib/fusionsolar/api-client.ts`). This is the only unit
   that runs real integration logic on this VM — see "Huawei Gateway" below.
2. **`voltessa-telemetry-ingestion.timer`** — fires every 5 minutes, calls back into Vercel to
   ingest `DeviceTelemetry`. See "Systemd Timers" below.
3. **`voltessa-market-price-scheduler.timer`** — fires once daily, calls back into Vercel to import
   ENTSO-E day-ahead prices. See "Systemd Timers" below.

The two timers only trigger HTTPS calls into the Vercel-hosted app (`CRON_SECRET`-guarded); neither
runs Huawei/business logic itself — all of that lives in `apps/web`. They are deliberately
independent units (separate service files, separate env files) so that a failure or change to one
can never affect the other, even though they currently share the same underlying `CRON_SECRET`
value (per ADR-008, every `app/api/internal/**` route shares one secret).

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

```
voltessa-telemetry-ingestion.timer  (OnCalendar=*:0/5 — every 5 minutes)
  -> voltessa-telemetry-ingestion.service  (curl, Bearer CRON_SECRET)
  -> POST https://app.voltessa.ai/api/internal/fusionsolar/bootstrap-device-telemetry?days=1
  -> route.ts: crypto.timingSafeEqual auth check
  -> bootstrapDeviceTelemetry() (apps/web/lib/fusionsolar/bootstrap-device-telemetry.ts)
  -> importDeviceTelemetry() (apps/web/lib/fusionsolar/import-device-telemetry.ts)
  -> Huawei getDevFiveMinutes, via the FusionSolar gateway (this same VM)
  -> DeviceTelemetry table (createMany, skipDuplicates: true)
  -> Dashboard / Market read it via lib/telemetry/queries.ts
```

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

Commands:

```
systemctl list-timers
systemctl status voltessa-telemetry-ingestion.timer
systemctl status voltessa-market-price-scheduler.timer
journalctl -u voltessa-telemetry-ingestion.service -f
journalctl -u voltessa-market-price-scheduler.service -f
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
2. `systemctl list-timers` — confirm the "next" fire time is within 5 minutes of now, not stalled.
3. `journalctl -u voltessa-telemetry-ingestion.service --since "15 min ago"` — check the last few
   runs. Look for `ok:true` with a per-plant summary (samples fetched/inserted/duplicates), or an
   error.
4. **HTTP 401** in the logs → `CRON_SECRET` mismatch. Rotate it (see "Systemd Timers" above) — the
   old value cannot be read back, only replaced.
5. **HTTP 200 but stale data anyway** → check whether the route being called is actually
   `bootstrap-device-telemetry` (writes `DeviceTelemetry`, what Dashboard/Market read) and not the
   legacy `ingest-plant-telemetry` route (writes the unrelated `PlantTelemetrySnapshot` table —
   confirmed dormant, not scheduled by anything, per `docs/research/telemetry-platform-foundation.md`
   §8.2). Check the service's `ExecStart`/script target URL if this is ever in doubt.
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
systemd-analyze calendar '*-*-* 14:00:00 Europe/Sofia'

# Logs
journalctl -u voltessa-fusionsolar-proxy -f
journalctl -u voltessa-fusionsolar-proxy --since "10 min ago"
journalctl -u voltessa-telemetry-ingestion.service --since "15 min ago"
journalctl -u voltessa-market-price-scheduler.service --since "today"

# Inspecting source/config
cat /opt/voltessa-fusionsolar-proxy/server.js
cat /opt/voltessa-fusionsolar-proxy/package.json
cat /etc/voltessa-fusionsolar-proxy.env
cat /etc/voltessa-telemetry-scheduler.env
cat /usr/local/bin/voltessa-market-price-poll.sh
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
