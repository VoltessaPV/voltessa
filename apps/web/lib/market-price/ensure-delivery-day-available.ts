/**
 * On-Demand Delivery Day Recovery (Market Price Reliability milestone,
 * follow-up). The scheduled 14:00 Europe/Sofia primary import and its
 * overnight recovery loop (`refresh-market-prices.ts`,
 * `voltessa-market-price-poll.sh`) remain the primary mechanism - this is a
 * separate safeguard for the moment an application code path actually
 * NEEDS a specific Bulgaria delivery day and finds it missing or
 * incomplete: the Market/Dashboard page browsing a specific date, or the
 * Market Price Optimization scheduler needing today's data.
 *
 * The recovery unit is always the ENTIRE Bulgaria delivery day, never a
 * single interval - see `ensureMarketPricesForBulgariaDays`'s own doc
 * comment for why (an automation asking for one interval will need the
 * next one shortly after; healing the whole day up front avoids repeated
 * ENTSO-E requests as different intervals get requested over the day).
 *
 * Reuses the existing fetch/parse/validate/persist pipeline verbatim
 * (`ensureMarketPricesForBulgariaDays` -> `refreshMarketPrices` ->
 * `fetchEntsoeDayAheadPrices`/`parseEntsoeDayAheadPricesXml`) - this module
 * adds exactly two things on top: a date-range guard, and a Postgres
 * advisory lock so concurrent callers for the same day never both fire a
 * real ENTSO-E request.
 *
 * Production Latency Architecture milestone: this safeguard used to be
 * awaited inline by Dashboard/Market page render and by the automation
 * scheduler, which meant a genuinely missing/incomplete day made a
 * user-facing page (or a 15-minute automation cycle) wait synchronously on
 * ENTSO-E and/or IBEX - up to `DASHBOARD_RECOVERY_DEADLINE_MS`/
 * `AUTOMATION_RECOVERY_DEADLINE_MS` plus lock overhead. `mode: "background"`
 * (every real caller today) keeps the cheap completeness check inline -
 * it's a single indexed read, no different from any other DB query the
 * caller already does - but hands the expensive part (lock acquisition +
 * the actual ENTSO-E/IBEX fetch) to `schedule` (Next.js `after()` by
 * default) instead of awaiting it, exactly like
 * `ensureTelemetryFresh`'s own "background" mode
 * (`lib/fusionsolar/telemetry-sync-service.ts`). The caller's own
 * render/response NEVER waits on an external market-data provider; a day
 * found incomplete this cycle renders as unavailable this one time, and is
 * healed in the background for the next request to see. `mode: "blocking"`
 * (the default, for backward compatibility with this module's existing
 * tests and any future caller that genuinely needs to know the outcome
 * before proceeding) preserves the exact original inline-await behavior.
 */

import { after } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  ensureMarketPricesForBulgariaDays,
  isBulgariaLocalDayComplete,
} from "@/lib/market-price/refresh-market-prices";
import { formatDateInZone } from "@/lib/market-price/timezone";

const BULGARIA_TIMEZONE = "Europe/Sofia";

/**
 * On-demand recovery is never attempted for a delivery day before this
 * date, regardless of whether it's technically missing - out of this
 * safeguard's intended scope (healing a day the application actually needs
 * *now*, not backfilling arbitrary history; see the admin historical-imports
 * tool / `backfillMarketPrices` for that).
 */
const MIN_RECOVERY_DATE = "2026-07-01";

/**
 * Dashboard/Market page budget: this runs inline in a page request, so it
 * must not risk a platform function timeout. IBEX Fallback milestone:
 * raised from 8s to 20s (and `vercel.json` now gives the Market page an
 * explicit `maxDuration: 30`, mirroring the existing
 * `admin/historical-imports` entry for the same reason) because a
 * worst-case attempt is no longer a single ENTSO-E call - it can be an
 * ENTSO-E attempt (`ENTSOE_REQUEST_TIMEOUT_MS` = 15s) FOLLOWED BY the IBEX
 * fallback's own 3-step handshake (`IBEX_REQUEST_TIMEOUT_MS` = 10s per
 * step in `providers/ibex.ts`) for the same CET day. A request that still
 * times out here simply falls through to the existing "unavailable"
 * rendering - it never hangs the page, and the wrapping advisory-lock
 * transaction (`withBulgariaDeliveryDayLock`) is bounded to
 * `deadlineMs + LOCK_TRANSACTION_OVERHEAD_MS` regardless, so this can never
 * run away indefinitely even if a step above ever forgot its own timeout.
 */
export const DASHBOARD_RECOVERY_DEADLINE_MS = 20_000;

/**
 * Automation budget: this runs once at the start of a 15-minute scheduler
 * cycle (`market-price-optimization-scheduler.ts`), so it must leave a wide
 * margin before the next cycle fires. IBEX Fallback milestone: raised from
 * 60s to 90s for the same reason as the dashboard budget above (ENTSO-E
 * attempt + IBEX's multi-step fallback, per CET day) - still only 10% of
 * the 15-minute window even in the worst case (both CET-day components
 * needing both providers), comfortably bounded.
 */
export const AUTOMATION_RECOVERY_DEADLINE_MS = 90_000;

/** Extra time given to the wrapping transaction beyond the recovery deadline itself, for lock-wait and query overhead. */
const LOCK_TRANSACTION_OVERHEAD_MS = 5_000;

/**
 * A fixed namespace for this module's advisory locks, paired with a
 * per-day integer key (days since epoch) via Postgres's two-int
 * `pg_advisory_xact_lock(int, int)` overload - avoids any need to hash a
 * string into a single bigint key.
 */
const RECOVERY_LOCK_NAMESPACE = 424_242;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Serializes concurrent on-demand recovery attempts for the same Bulgaria
 * delivery day using a Postgres advisory lock, TRANSACTION-scoped
 * (`pg_advisory_xact_lock`, auto-released at commit/rollback) rather than
 * session-scoped (`pg_advisory_lock` / `pg_advisory_unlock`). This
 * distinction is load-bearing, not stylistic: `DATABASE_URL` points at
 * Neon's pooled endpoint (see the "-pooler" hostname, `CLAUDE.md`'s
 * Configuration section) - PgBouncer transaction-mode pooling, under which
 * a session-scoped lock and its later unlock call could silently land on
 * two different underlying Postgres connections and never actually
 * exclude anything. Prisma's interactive `$transaction` reserves one
 * connection for its entire callback, which is exactly what keeps the
 * lock's acquire (and its implicit release at the end of the callback)
 * safe here.
 *
 * `fn` itself still reads/writes through the ordinary `prisma` singleton
 * (not the transaction client) - it doesn't need to be part of this same
 * atomic transaction, only serialized in time by it, so
 * `ensureMarketPricesForBulgariaDays`/`refreshMarketPrices` stay completely
 * unchanged and un-duplicated.
 */
async function withBulgariaDeliveryDayLock(
  dayStart: Date,
  fn: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  const lockKey = Math.floor(dayStart.getTime() / ONE_DAY_MS);

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RECOVERY_LOCK_NAMESPACE}::int, ${lockKey}::int)`;
      await fn();
    },
    { timeout: timeoutMs, maxWait: timeoutMs },
  );
}

export type EnsureBulgariaDeliveryDayOverrides = {
  isComplete?: (dayStart: Date) => Promise<boolean>;
  recover?: (dayStart: Date, deadline: number) => Promise<{ imported: boolean; errors: string[] }>;
  withLock?: (dayStart: Date, fn: () => Promise<void>) => Promise<void>;
  now?: () => Date;
  /**
   * "blocking" (default): waits for the lock + recovery attempt to finish
   * (or its deadline to elapse) before this function's own promise
   * resolves - the original, still-tested behavior.
   *
   * "background": returns as soon as the cheap completeness check settles;
   * if the day is incomplete, the lock+recovery step is handed to
   * `schedule` instead of being awaited - see this module's top doc
   * comment. Every real production caller uses this mode.
   */
  mode?: "blocking" | "background";
  /** "background" mode only. Defaults to Next.js `after()`; overridable so tests can invoke the deferred work manually instead of needing a real request scope. */
  schedule?: (fn: () => Promise<void>) => void;
};

/**
 * The on-demand safeguard's single entry point. Both callers (the
 * Dashboard/Market page and the Market Price Optimization scheduler) call
 * this unconditionally before their own normal read - it is a fast no-op
 * whenever the day is out of the allowed range or already complete, and
 * only ever performs real work (behind the advisory lock) when genuinely
 * needed. Never throws: a recovery failure here is best-effort and must
 * never break the caller's own request - the caller's EXISTING "no valid
 * price" / "unavailable" handling (unchanged by this module) is what
 * takes over when recovery doesn't succeed.
 *
 * Date rules (Bulgaria-local calendar date, via the existing
 * `formatDateInZone` - no new timezone/date math):
 *   - before 2026-07-01: never attempted (out of this safeguard's scope).
 *   - after today's Bulgaria-local date: never attempted (that is the
 *     PRIMARY scheduler's job, at 14:00 for "tomorrow" specifically - this
 *     safeguard heals a day the application needs now, it never pre-fetches).
 *   - 2026-07-01 through today inclusive: recovered if missing/incomplete.
 *
 * `overrides` exist only for tests - production callers always get the
 * real completeness check, the real `ensureMarketPricesForBulgariaDays`,
 * and the real Postgres advisory lock.
 */
export async function ensureBulgariaDeliveryDayAvailable(
  dayStart: Date,
  deadlineMs: number,
  overrides: EnsureBulgariaDeliveryDayOverrides = {},
): Promise<void> {
  const now = overrides.now ?? (() => new Date());
  const isComplete = overrides.isComplete ?? isBulgariaLocalDayComplete;
  const recover =
    overrides.recover ?? ((day, deadline) => ensureMarketPricesForBulgariaDays([day], deadline));
  const withLock =
    overrides.withLock ??
    ((day, fn) => withBulgariaDeliveryDayLock(day, fn, deadlineMs + LOCK_TRANSACTION_OVERHEAD_MS));
  const mode = overrides.mode ?? "blocking";
  const schedule = overrides.schedule ?? after;

  const deliveryDate = formatDateInZone(dayStart, BULGARIA_TIMEZONE);
  const todayDate = formatDateInZone(now(), BULGARIA_TIMEZONE);

  if (deliveryDate < MIN_RECOVERY_DATE || deliveryDate > todayDate) {
    return;
  }

  const recoverUnderLock = () =>
    withLock(dayStart, async () => {
      // Re-check AFTER acquiring the lock - another concurrent caller may
      // have already restored this exact day while we were waiting, in
      // which case we must perform no second ENTSO-E request.
      if (await isComplete(dayStart)) {
        return;
      }

      await recover(dayStart, Date.now() + deadlineMs);
    });

  try {
    if (await isComplete(dayStart)) {
      return;
    }

    if (mode === "background") {
      // Fire-and-forget from THIS function's own caller's perspective -
      // the lock wait and the real ENTSO-E/IBEX call happen after this
      // promise has already resolved, via `schedule` (Next.js `after()`
      // in production), so a user-facing page or automation cycle never
      // waits on them. Errors here can no longer be caught by the outer
      // try/catch below (this function has already returned by the time
      // they'd occur), so they're caught right here instead - this must
      // never surface as an unhandled rejection.
      schedule(() =>
        recoverUnderLock().catch((error) => {
          console.error("[Market Price On-Demand Recovery] Failed", {
            deliveryDate,
            error,
          });
        }),
      );
      return;
    }

    await recoverUnderLock();
  } catch (error) {
    console.error("[Market Price On-Demand Recovery] Failed", {
      deliveryDate,
      error,
    });
  }
}
