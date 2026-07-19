# Continuous ENTSO-E Daily Price Refresh — Engineering Report

Status: **Implemented and validated against production.** Two independent Scaleway `systemd`
schedulers now exist — one for FusionSolar telemetry (every 5 minutes, ADR-008,
`docs/research/telemetry-platform-foundation.md` §8) and one for ENTSO-E day-ahead market prices
(once daily, ADR-009, this report).

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
- **`23:15 UTC`, fixed, not a local-time expression.** `Europe/Brussels` (the CET/CEST zone ENTSO-E's
  market day is anchored to, `lib/market-price/timezone.ts`) is at most UTC+2 (summer). `23:15 UTC`
  is therefore always past Brussels midnight in both DST states (22:00 UTC winter boundary, 21:00
  UTC summer boundary), so `refreshMarketPrices`'s `new Date()`-based "today" always resolves to the
  correct, already-published upcoming delivery day — verified directly: running at `23:24 UTC` on
  2026-07-19 correctly targeted delivery day `2026-07-20`.
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
