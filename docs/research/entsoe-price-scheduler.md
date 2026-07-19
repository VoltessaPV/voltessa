# Continuous ENTSO-E Daily Price Refresh — Engineering Report

Status: **Implemented and validated against production**, refined by the Scheduler refinement
milestone (§9) to poll from ENTSO-E's real publication window instead of waiting until day's end.
Two independent Scaleway `systemd` schedulers exist — one for FusionSolar telemetry (every 5
minutes, ADR-008, `docs/research/telemetry-platform-foundation.md` §8) and one for ENTSO-E
day-ahead market prices (§9's polling strategy, ADR-009, this report).

## 1. Pipeline trace (as it exists after this milestone)

```
Scaleway systemd timer (voltessa-market-price-scheduler.timer, OnCalendar=*-*-* 23:15:00 UTC)
  -> voltessa-market-price-scheduler.service (curl, Bearer CRON_SECRET)
  -> POST https://app.voltessa.ai/api/internal/market-price/refresh-prices
  -> route.ts: crypto.timingSafeEqual auth check
  -> refreshMarketPrices() (lib/market-price/refresh-market-prices.ts)
  -> fetchEntsoeDayAheadPrices() (lib/market-price/providers/entsoe.ts)
  -> ENTSO-E Transparency Platform API (direct HTTPS, no gateway - unlike FusionSolar)
  -> MarketPrice / MarketPriceImport (Prisma)
  -> Market page (lib/market-price/provider.ts -> market-data.ts -> MarketPriceChart)
```

Every stage was verified directly against production before any change was made, per the
milestone's own instruction not to assume.

## 2. Root cause — two real, distinct production bugs, not one

The milestone brief asked to "prove the actual root cause" for why today's prices weren't imported
automatically. Investigating found **two** independent bugs, not one:

### 2.1 No scheduler existed

Exhaustively checked every mechanism available to this codebase or its production infrastructure:
no `.github/workflows/*` entry, no entry in the Scaleway host's `/etc/cron.d/`, no root `crontab`,
no `systemd` timer. `refreshMarketPrices`/`backfillMarketPrices` are called from exactly one place
in the codebase (`app/api/internal/market-price/refresh-prices/route.ts`), and nothing calls that
route automatically — confirmed by grepping every reference to both functions. This mirrors
telemetry's pre-ADR-008 gap in kind, but is a separate pipeline with its own separate gap.

### 2.2 `ENTSOE_API_TOKEN` was never actually configured in Vercel production

This is the deeper bug, and the reason a scheduler alone would not have been sufficient. Calling
`refresh-prices` manually against `app.voltessa.ai` (before any fix) reproduced, on every attempt:

```
{"ok":false,"error":"market_price_refresh_failed","reason":"ENTSOE_API_TOKEN is not configured"}
HTTP 500
```

`ENTSOE_API_TOKEN` has been declared in `turbo.json`'s `globalEnv` since the original ENTSO-E
integration milestone (`bdea5f2`/`76068a4`) — meaning it was always *intended* to be required
configuration — but `vercel env ls production` showed it did not exist as an actual Vercel
environment variable at all. The real token was found in local `.env`/`.env.local` (gitignored,
confirmed never committed: `git check-ignore` and `git ls-files` both confirm). This means every
`MarketPrice` row already present in the production database was written by someone running the
importer from local development directly against the production `DATABASE_URL` — production itself
had never once succeeded at importing prices on its own, at any point since the feature was built.

Fixed by provisioning the same real token (not a new/fabricated one) into Vercel Production and
Preview via `vercel env add ENTSOE_API_TOKEN production/preview --force`, then deploying so the
serverless functions picked up the new value (Vercel environment variables are snapshotted
per-deployment, confirmed empirically in the telemetry milestone — a redeploy is required after any
change, not just a config-side update).

**Before/after, same endpoint, captured in Vercel's own runtime logs:**

```
23:15:50  POST /api/internal/market-price/refresh-prices  500  [old deployment, missing token]
    [Market Price Refresh] Failed { error: EntsoeApiError: ENTSOE_API_TOKEN is not configured }

23:24:21  POST /api/internal/market-price/refresh-prices  200  [new deployment, token provisioned]
    [Market Price Refresh] Delivery day processed {
      biddingZone: '10YCA-BULGARIA-R', targetDeliveryDay: '2026-07-20',
      recordsDownloaded: 96, recordsInserted: 96, duplicatesSkipped: 0,
      missingIntervals: 0, isPartial: false
    }
```

## 3. Idempotency — re-verified against production, not re-assumed

`refreshMarketPrices` already used `prisma.marketPrice.upsert` keyed on the real
`@@unique([biddingZone, timestamp, source])` constraint — no duplicate rows were ever structurally
possible. Verified directly by calling `refresh-prices` twice in immediate succession against
production:

| Run | recordsDownloaded | recordsInserted | duplicatesSkipped |
|---|---|---|---|
| 1st | 96 | 96 | 0 |
| 2nd (immediately after) | 96 | **0** | 96 |

`recordsInserted`/`duplicatesSkipped` are new (see §4) — determined by a pre-write existence check
purely for accurate logging; the write itself is still the same per-point `upsert` as before, so if
ENTSO-E ever revises an already-published value the next scheduled run still self-heals it rather
than permanently skipping. `MarketPriceImport` (the audit-log table) still gets one new row per
call, by design (it records "an import ran and here's what happened," not "here's the current
state" — see its own schema doc comment) — this is expected growth, not a duplicate-data bug.

## 4. Logging added

Both the route and `refreshMarketPrices` now log: a start timestamp, the resolved target delivery
day (`formatDateInZone`, reusing the existing timezone utility rather than re-deriving it), records
downloaded/inserted/duplicates-skipped, missing intervals, `isPartial`, execution duration, and any
failure. Verified live in Vercel's runtime logs (§2.2's log excerpt above is real, captured output).

## 5. Graceful handling of "not yet published"

ENTSO-E's API returns an `Acknowledgement_MarketDocument` (its own documented response shape for
"the request is valid but nothing matches it") instead of a `Publication_MarketDocument` when a
period has no data — most commonly hit if this importer were ever called before a day's prices are
published. Previously this was thrown as a generic `EntsoeApiError`, which the route surfaces as
HTTP 500 — indistinguishable from a genuine failure. Added `EntsoeNoDataAvailableError` (a subclass)
specifically for this response shape; `refreshMarketPrices` catches it and returns a normal
`unavailable: true` result (logged, not thrown), so a scheduled run landing on this condition
succeeds gracefully — exactly the milestone's explicit requirement — while a real error (malformed
XML, wrong bidding zone, non-2xx HTTP status) still surfaces as a failure worth alerting on.

Not reproduced live in production for this milestone (today's data was already published at
investigation time — see §2.2's `isPartial: false`, 96/96 intervals); the fix is a direct decode of
ENTSO-E's own documented acknowledgement contract, not a guess, but the graceful-degradation path
itself has not been exercised against a real "not yet published" response.

## 6. Why the two schedulers are kept separate (not a merged "data refresh" job)

- **Different cadence for a real reason, not an arbitrary choice.** Telemetry is operational data
  (how much the plant is producing right now) that changes every 5 minutes and future automation
  needs fresh within a 15-minute settlement interval (ADR-008). ENTSO-E day-ahead prices are
  published once, for the whole next day, in one batch, the previous afternoon — there is no new
  data to fetch more than once a day; calling more often would only produce redundant idempotent
  no-ops, never fresher data.
- **`23:15 UTC`, fixed, not a local-time expression** *(original design — superseded by §9's
  14:00 Europe/Sofia polling strategy; kept here as the historical record of why a fixed-UTC time
  was originally chosen, since §9's design still relies on the same Brussels/UTC DST reasoning)*.
  `Europe/Brussels` (the CET/CEST zone ENTSO-E's market day is anchored to,
  `lib/market-price/timezone.ts`) is at most UTC+2 (summer). `23:15 UTC` is therefore always past
  Brussels midnight in both DST states (22:00 UTC winter boundary, 21:00 UTC summer boundary), so
  `refreshMarketPrices`'s `new Date()`-based "today" always resolves to the correct, already-
  published upcoming delivery day — verified directly: running at `23:24 UTC` on 2026-07-19
  correctly targeted delivery day `2026-07-20`. The downside this original design accepted: prices
  for tomorrow are typically published by ENTSO-E around midday CET, so waiting until nearly
  midnight meant Voltessa held correct-but-many-hours-stale data for most of the afternoon/evening
  before importing it — acceptable for the "make it work automatically at all" milestone, revisited
  in §9.
- **Separate unit files, separate env files, same underlying `CRON_SECRET` value.** Every
  `app/api/internal/**` route shares one `CRON_SECRET` (by existing convention, ADR-008), so both
  scheduler env files currently hold the same value — but they are still two independent `systemd`
  units so that a failure, a future re-cadence, or a logging change to one can never affect the
  other. Confirmed independent in production: both timers are `active (waiting)` simultaneously,
  telemetry firing every 5 minutes throughout this milestone's work with zero disruption from adding
  or firing the new daily unit.

## 7. Production verification

- New Vercel deployment confirmed live (`ENTSOE_API_TOKEN` present, code deployed) before any
  validation was attempted.
- Manual double-call against production: first-ever successful production import (96/96 intervals,
  `isPartial: false`) followed by a zero-duplicate re-run (§3).
- `voltessa-market-price-scheduler.timer` created, enabled, and confirmed `active (waiting)` with a
  correctly-computed next trigger (`Mon 2026-07-20 23:15:00 UTC` at creation time — one full day out,
  as expected for a daily cadence).
- Because the real cadence is daily, waiting for an actual unattended trigger was not practical
  within this session; instead the underlying `.service` unit was fired directly
  (`systemctl start voltessa-market-price-scheduler.service`) — the exact same `ExecStart` a real
  timer trigger would run — and confirmed via `journalctl` to complete successfully
  (`Finished voltessa-market-price-scheduler.service`, idempotent 0-inserted/96-duplicates-skipped
  result, matching §3 exactly). This validates the deployed unit, env file, and auth end-to-end; the
  timer's own `OnCalendar` schedule is what determines it will also fire unattended tomorrow.
- `voltessa-telemetry-ingestion.timer` (ADR-008) confirmed to keep running on its own independent
  5-minute cadence throughout, unaffected by any of this work.

## 8. What was deliberately not touched

No changes to Dashboard, Market UI, or `MarketPriceChart.tsx`. No changes to any revenue/settlement
calculation (`lib/telemetry/energy-metrics.ts`, `market-data.ts`'s revenue derivation) — this
milestone is infrastructure-only, per its own constraints. No changes to `backfillMarketPrices`'s
own day-walking logic, `MarketPrice`'s schema, or the bidding-zone/currency/resolution validation
policy already documented in `lib/market-price/providers/entsoe.ts`'s module doc comment.

## 9. Scheduler refinement — poll from ENTSO-E's real publication window (follow-up milestone)

§6/§7 shipped a fixed `23:15 UTC` single daily call, deliberately timed to land after the delivery
day had already become "today" so the existing `refreshMarketPrices()` default (no argument fetches
the Brussels calendar day containing `new Date()`) needed no changes. The accepted cost (noted in
§6's updated bullet) was up to ~9-10 hours of unnecessary staleness — ENTSO-E actually publishes a
day's prices around midday CET, not near midnight. This milestone closes that gap: poll starting
shortly after the real publication window, retry only as long as genuinely needed, and stop the
instant a complete dataset arrives.

### 9.1 The importer needed one new capability: fetching *tomorrow*, not just *today*

`refreshMarketPrices(referenceDate = new Date())` always resolves "the Brussels calendar day
containing `referenceDate`." At 14:00 Europe/Sofia (13:00 Brussels time, since Sofia is one hour
ahead), that calendar day is still *today* — the day already known, not tomorrow's newly-published
prices. Polling for the actually-new data therefore requires explicitly requesting *tomorrow*.

Per the milestone's explicit instruction to avoid changing the importer if possible: `
refreshMarketPrices(referenceDate)` already accepted an arbitrary reference date — nothing in
`lib/market-price/refresh-market-prices.ts` or `lib/market-price/providers/entsoe.ts` changed.
The only code change is a new `?target=tomorrow` query parameter on
`app/api/internal/market-price/refresh-prices/route.ts` (the controller/HTTP layer) that computes
`new Date(Date.now() + 24h)` and passes it through — a caller-side choice of which day to ask for,
exactly the kind of thing that belongs in the route per this repo's Controller/Service convention.

Verified directly against production: calling with `?target=tomorrow` at 23:24 UTC on 2026-07-19
correctly resolved to `periodStart: 2026-07-20T22:00:00.000Z` (one full day later than the
`?target` omitted / default "today" call made minutes earlier in §2.2, which resolved to
`2026-07-19T22:00:00.000Z`) — and, since real ENTSO-E publication for that delivery day genuinely
had not happened yet at that hour, the call returned `unavailable: true` live in production — the
first real-world exercise of the graceful "not published yet" path added in §5 (previously only
verified by reasoning about ENTSO-E's documented contract, not observed live).

### 9.2 The retry/stop policy lives entirely in the scheduler, not the importer

Per the milestone's explicit preference, all polling/retry/stop decisions live in the Scaleway
`systemd` service script (`/usr/local/bin/voltessa-market-price-poll.sh`), not in application code:

- `voltessa-market-price-scheduler.timer`'s `OnCalendar` changed from the fixed `23:15 UTC` to
  `*-*-* 14:00:00 Europe/Sofia` — a single daily trigger. systemd resolves the IANA zone (and its
  DST transitions) itself; confirmed via `systemd-analyze calendar '*-*-* 14:00:00 Europe/Sofia'`
  on the actual host, which normalized to `11:00 UTC` (correct for EEST/summer) and will resolve to
  `12:00 UTC` once winter (EET) begins — no manual DST bookkeeping required, and no change to the
  server's own system timezone (which stays `Etc/UTC`, unaffected, avoiding any risk to the other
  unrelated system timers — `certbot`, `logrotate`, `apt-daily`, etc. — sharing this host).
- The service's `ExecStart` is now a script, not an inline `curl`, because the retry policy needs
  real control flow: it calls `refresh-prices?target=tomorrow`, parses the JSON response with `jq`,
  and either exits `0` immediately (a complete import — `ok:true`, `unavailable:false`,
  `isPartial:false`) or sleeps 1800 seconds (30 minutes) and retries, up to `MAX_ATTEMPTS=16`
  (~8 hours of headroom — 14:00 to 22:00 Europe/Sofia — comfortably inside the 24h before the next
  day's trigger, so an unresolved day can never overlap the next one's polling). Exhausting all 16
  attempts without a complete import is treated as a real failure (non-zero exit, visible in
  `journalctl`/monitoring as a failed unit) — genuinely different from "not published yet," which is
  explicitly not an error per the milestone's own instruction.
- `systemd`'s default `TimeoutStartSec` (90 seconds) would otherwise kill a script that can
  legitimately run for hours — `TimeoutStartSec=infinity` was added to the service unit; missing
  this would have silently broken every retry cycle after the first 90 seconds, so it was checked
  explicitly, not assumed.
- A real bug was caught and fixed before deployment by testing the exact `jq` filters against
  captured real response JSON rather than trusting them by inspection: `jq`'s `//` "alternative"
  operator treats a literal `false` the same as `null`/missing, so an initial `.isPartial // true`
  filter silently turned a genuine `isPartial: false` (i.e. success) into the string `"true"` —
  meaning the script would never have detected a successful complete import and would have retried
  forever until giving up, every single day. Fixed by removing the `// default` fallback from the
  three boolean fields (`ok`, `unavailable`, `isPartial` — all always present in every real
  response, so no fallback is needed; malformed/absent JSON degrades safely to an empty string,
  which correctly fails the success check rather than misreading it either way).

### 9.3 Validation

- **"Not yet published" path** — exercised live (§9.1): a real manual trigger of the deployed
  service at 23:44 UTC on 2026-07-19 (well outside the intended 14:00 Sofia window, run purely to
  validate the mechanism) correctly logged `Response: ok=true unavailable=true isPartial=true
  imported=0/0`, `Tomorrow's prices not yet published - not an error, will retry`, and
  `Sleeping 1800s before retry` — then was manually stopped (`systemctl stop`) rather than left to
  either succeed hours later at the wrong time-of-day or exhaust its 16 attempts outside the real
  daily window; `systemctl reset-failed` cleared the resulting SIGTERM-induced `failed` state
  afterward so it does not confuse the next real trigger.
- **"Complete success, stop immediately" path** — exercised live by running the actual deployed
  script (not a simulation) with its target URL redirected to the default (`today`, already known to
  be complete — 96/96 intervals) instead of `tomorrow`: `Attempt 1/16` → `Response: ok=true
  unavailable=false isPartial=false imported=96/96` → `Complete next-day dataset imported (96/96
  intervals) - stopping retries for today` → process exit code `0`, no second attempt. Confirms the
  jq-filter fix (§9.2) actually works in the full script, not just in isolated testing.
- **Idempotency** — the underlying write path (`refreshMarketPrices`'s `upsert`, §3/§4) is
  completely unchanged by this milestone; the success-path test above wrote to the same
  already-imported day and, consistent with every prior verification, created no new rows.
- **Independence from telemetry** — `voltessa-telemetry-ingestion.timer` (ADR-008) continued firing
  every 5 minutes throughout this milestone's work (deploys, manual triggers, a killed test run)
  with zero disruption, confirmed via `systemctl list-timers` before and after.
- Real, fully unattended validation of the daily 14:00 Europe/Sofia trigger (as opposed to manual
  triggers of the same deployed unit) was not observed within this session, for the same reason
  noted in §7 — the actual next occurrence is `2026-07-20 11:00:00 UTC` (`14:00` Sofia,
  confirmed via `systemctl list-timers`).
