# Scaleway Production Infrastructure — Operator Runbook

Status: living document. Update it whenever a service, timer, allow-listed endpoint, or SOP step
changes — this file, not chat history, is the source of truth for future sessions.

---

# Overview

Voltessa's production deployment spans three separate pieces of infrastructure:

- **Vercel** hosts the Next.js application (`apps/web`) — the actual product, including all UI,
  server actions, and API routes.
- **PostgreSQL** is managed separately (not on Vercel, not on the Scaleway VM) — reached via
  `DATABASE_URL`.
- **A dedicated Scaleway VM** hosts all background infrastructure that Vercel cannot or should not
  run directly: the FusionSolar gateway proxy, and the two production schedulers (telemetry
  ingestion, market-price refresh). See `CLAUDE.md`'s "Architecture" section and ADR-004/ADR-009 in
  `docs/ARCHITECT_DECISIONS.md` for why this exists (Vercel Cron was tried for scheduling and
  reverted; FusionSolar API access needed a stable, allow-listable egress point and centralized
  secret handling in front of Huawei's API).

VM hostname: `voltessa-fusionsolar-proxy`

## Responsibility of this VM

1. **FusionSolar gateway proxy** (`voltessa-fusionsolar-proxy.service`) — the only thing in the
   entire system that is allowed to call Huawei's FusionSolar API directly. `apps/web` never calls
   Huawei directly; it always goes through this gateway via `FUSIONSOLAR_GATEWAY_URL` +
   `FUSIONSOLAR_GATEWAY_SECRET` (`apps/web/lib/fusionsolar/api-client.ts`).
2. **Telemetry ingestion scheduler** (`voltessa-telemetry-ingestion.timer`) — triggers
   `bootstrap-device-telemetry` on Vercel every 5 minutes.
3. **Market-price refresh scheduler** (`voltessa-market-price-scheduler.timer`) — triggers
   `refresh-prices` on Vercel once daily.

Both timers call back into the Vercel-hosted app over HTTPS (`CRON_SECRET`-guarded); they don't run
any application logic themselves. The gateway proxy is the only piece that runs real integration
logic on this VM.

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
(authenticated via `x-gateway-secret`), forwards them to Huawei's FusionSolar API, and relays the
response back.

- **WorkingDirectory**: `/opt/voltessa-fusionsolar-proxy`
- **ExecStart**: runs the proxy's entry point (`server.js`) from that working directory — confirm
  the exact interpreter/flags with `systemctl cat`, below, rather than assuming.
- **EnvironmentFile**: `/etc/voltessa-fusionsolar-proxy.env` (holds the proxy's own secrets/config —
  not the same file as `apps/web`'s `.env`, and not committed anywhere; root-only).

Commands:

```
systemctl status voltessa-fusionsolar-proxy
systemctl cat voltessa-fusionsolar-proxy
systemctl restart voltessa-fusionsolar-proxy
journalctl -u voltessa-fusionsolar-proxy -f
```

---

# Cron / Timers

## `voltessa-telemetry-ingestion.timer`

Runs every 5 minutes. Calls
`POST https://app.voltessa.ai/api/internal/fusionsolar/bootstrap-device-telemetry?days=1`
(`CRON_SECRET`-guarded) — writes `DeviceTelemetry` rows, the table Dashboard/Market read. See
`docs/research/telemetry-platform-foundation.md` §8 for the full history (this replaced an earlier,
silently-broken timer that targeted the wrong/legacy endpoint).

## `voltessa-market-price-scheduler.timer`

Triggers once daily at `14:00 Europe/Sofia` (shortly after ENTSO-E's real day-ahead publication
window). Runs a script that polls
`app/api/internal/market-price/refresh-prices?target=tomorrow` every 30 minutes until a complete
import succeeds or a bounded number of attempts is exhausted — all retry/stop logic lives in that
script, not in application code. Writes `MarketPrice`/`MarketPriceImport`. See
`docs/research/entsoe-price-scheduler.md` for the full history.

Commands:

```
systemctl list-timers
systemctl status voltessa-telemetry-ingestion.timer
systemctl status voltessa-market-price-scheduler.timer
journalctl -u voltessa-telemetry-ingestion.service -f
journalctl -u voltessa-market-price-scheduler.service -f
```

---

# Proxy Application

- **WorkingDirectory**: `/opt/voltessa-fusionsolar-proxy`
- **Entry point**: `server.js`
- **Dependencies**: `package.json` in the same directory
- **Environment file**: `/etc/voltessa-fusionsolar-proxy.env`

## Request flow

```
Voltessa (apps/web, Vercel)
    │  POST {FUSIONSOLAR_GATEWAY_URL}/v1/fusionsolar/api
    │  headers: Authorization: Bearer <token>, x-gateway-secret
    │  body: { path, body }
    ▼
Gateway (voltessa-fusionsolar-proxy, this VM)
    │  checks path against FUSIONSOLAR_ALLOWED_API_PATHS (see below)
    │  if allowed: forwards to Huawei
    ▼
Huawei FusionSolar (SmartPVMS Northbound API)
```

---

# Huawei Allow List

`server.js` contains `FUSIONSOLAR_ALLOWED_API_PATHS` — an allow-list of Huawei API paths the gateway
is willing to forward. **Every new Huawei endpoint must be added here before it can ever reach
Huawei.** Adding a new `lib/fusionsolar/*.ts` call in `apps/web` is not sufficient by itself — if
the path isn't in this list, the gateway rejects it locally and Huawei never sees the request.

## Debugging symptom

```
{ "ok": false, "error": "api_path_not_allowed" }
```

means **the request never left the proxy**. It was rejected locally, before ever being forwarded to
Huawei. Do not interpret this as a Huawei-side error, an OAuth scope problem, or a request-body
problem — none of those would produce this specific response, and none of them explain it as well
as a missing allow-list entry does.

## Verifying whether a specific path is allowed

```
grep -n "FUSIONSOLAR_ALLOWED_API_PATHS" -A 20 /opt/voltessa-fusionsolar-proxy/server.js
```

Check whether the exact path (e.g.
`/rest/openapi/pvms/nbi/v2/control/active-power-control/async-task`) appears in that list.

---

# Production Debugging Checklist

1. SSH into the VM (`ssh root@51.15.103.175`).
2. Check service health (`systemctl status voltessa-fusionsolar-proxy`).
3. Tail logs (`journalctl -u voltessa-fusionsolar-proxy -f`) — leave this running.
4. Verify the endpoint exists in the allow-list (`grep` `server.js` for
   `FUSIONSOLAR_ALLOWED_API_PATHS`, per above).
5. If the allow-list needed a change, follow the SOP below (inspect → explain → backup → modify →
   restart → verify) — restart the service after any change
   (`systemctl restart voltessa-fusionsolar-proxy`).
6. Retry the action from Voltessa (trigger the real button/flow that calls the gateway).
7. Inspect the upstream Huawei response in the tailed log — confirm the request actually reached
   Huawei this time, and read whatever Huawei returned (HTTP status, `failCode`, `message`).

---

# Common Commands

```
# Service
systemctl status voltessa-fusionsolar-proxy
systemctl restart voltessa-fusionsolar-proxy
systemctl cat voltessa-fusionsolar-proxy

# Timers
systemctl list-timers
systemctl status voltessa-telemetry-ingestion.timer
systemctl status voltessa-market-price-scheduler.timer

# Logs
journalctl -u voltessa-fusionsolar-proxy -f
journalctl -u voltessa-fusionsolar-proxy --since "10 min ago"

# Inspecting the proxy source
cat /opt/voltessa-fusionsolar-proxy/server.js
cat /opt/voltessa-fusionsolar-proxy/package.json
cat /etc/voltessa-fusionsolar-proxy.env

# Searching
grep -n "FUSIONSOLAR_ALLOWED_API_PATHS" -A 20 /opt/voltessa-fusionsolar-proxy/server.js
grep -rn "<search term>" /opt/voltessa-fusionsolar-proxy/

# Editing (see SOP below before using these on anything but a backup)
sed -n "<line-range>p" server.js      # inspect a range before editing
cp server.js server.js.bak.$(date +%Y%m%d-%H%M%S)   # always back up first
```

---

# Standard Operating Procedure — working on this VM

This applies to any future Claude session (or human) working on this VM, for anything beyond
read-only inspection. **Never edit production blindly.** Every change follows this order, in full,
every time:

1. **Inspect** — read the current state before touching anything: `systemctl status`,
   `systemctl cat`, `cat`/`grep` the relevant file(s), `journalctl` for recent behavior. Understand
   what's actually there, not what you assume is there.
2. **Explain** — state plainly, before editing, what you're about to change and why, referencing
   what you found in step 1. If you're a Claude session, say this to the user explicitly and get
   confirmation before proceeding — this is production infrastructure with real, live financial
   consequences (see `CLAUDE.md`, `docs/AI_PLAYBOOK.md`).
3. **Backup** — copy the file you're about to edit before editing it
   (`cp server.js server.js.bak.$(date +%Y%m%d-%H%M%S)`). Never edit in place without a backup you
   could restore from in seconds.
4. **Modify** — make the smallest change that addresses what step 2 described. Don't bundle
   unrelated cleanup into a production infrastructure edit.
5. **Restart** — apply the change (`systemctl restart voltessa-fusionsolar-proxy`, or the relevant
   timer/service). Config and code changes to a running service don't take effect until restarted.
6. **Verify** — tail logs (`journalctl -u voltessa-fusionsolar-proxy -f`) while retriggering the
   real flow that exercises the change, and confirm the actual behavior matches what step 2 said it
   would. Don't consider the change done until you've watched it work.

If any step reveals something unexpected (the file doesn't look like you expected, the service
doesn't restart cleanly, logs show something unrelated breaking) — stop, go back to Inspect, and
re-explain before continuing. Don't push through surprises on production infrastructure.

Future Claude sessions should be able to do all of the following on this VM, always through this
SOP: SSH in, inspect services, read production files, modify production files **when explicitly
requested**, restart services, tail logs, verify the result. Modifying production files without an
explicit request from the user is out of scope regardless of how confident the diagnosis is — per
`CLAUDE.md`'s autonomous-execution rules, this class of change is one of the few that must stop and
ask, not proceed independently.

---

# Future Changes

- **Never bypass the gateway.** `apps/web` must never call Huawei's API directly, from any route,
  action, or script — always through `FUSIONSOLAR_GATEWAY_URL`/`callFusionSolarApi`.
- **Never call Huawei directly from Vercel.** Same rule, stated from the other side — no serverless
  function should hold a direct HTTPS client to `support.huawei.com`/the FusionSolar API host.
- **Every new Huawei endpoint requires updating the allow-list** in `server.js`
  (`FUSIONSOLAR_ALLOWED_API_PATHS`) on this VM before the corresponding `lib/fusionsolar/*.ts` code
  in `apps/web` can ever succeed against it. Adding the Voltessa-side code first and testing later
  is fine; expect `api_path_not_allowed` until the allow-list is updated to match.
- **Restart the proxy after any change** to `server.js` or `/etc/voltessa-fusionsolar-proxy.env` —
  changes do not take effect until `systemctl restart voltessa-fusionsolar-proxy`.
- **Validate with `journalctl` while testing**, every time — don't assume a restart + retry worked
  without watching the logs confirm it.
