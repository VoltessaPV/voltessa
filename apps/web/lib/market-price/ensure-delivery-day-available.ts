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
 */

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
 * must not risk a platform function timeout. Chosen well under the
 * shortest realistic Vercel function timeout, while still giving one full
 * ENTSO-E attempt (`ENTSOE_REQUEST_TIMEOUT_MS` = 15s in
 * `providers/entsoe.ts`) a real chance to complete for at least one of the
 * (up to 2) CET-day components before giving up - a request that times out
 * here simply falls through to the existing "unavailable" rendering, it
 * never hangs the page.
 */
export const DASHBOARD_RECOVERY_DEADLINE_MS = 8_000;

/**
 * Automation budget: this runs once at the start of a 15-minute scheduler
 * cycle (`market-price-optimization-scheduler.ts`), so it must leave a wide
 * margin before the next cycle fires - 60s is <7% of that 15-minute window
 * even in the worst case (both CET-day components needing a full retry),
 * comfortably bounded, while still large enough to actually succeed most of
 * the time a same-day gap is discovered.
 */
export const AUTOMATION_RECOVERY_DEADLINE_MS = 60_000;

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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RECOVERY_LOCK_NAMESPACE}, ${lockKey})`;
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

  const deliveryDate = formatDateInZone(dayStart, BULGARIA_TIMEZONE);
  const todayDate = formatDateInZone(now(), BULGARIA_TIMEZONE);

  if (deliveryDate < MIN_RECOVERY_DATE || deliveryDate > todayDate) {
    return;
  }

  try {
    if (await isComplete(dayStart)) {
      return;
    }

    await withLock(dayStart, async () => {
      // Re-check AFTER acquiring the lock - another concurrent caller may
      // have already restored this exact day while we were waiting, in
      // which case we must perform no second ENTSO-E request.
      if (await isComplete(dayStart)) {
        return;
      }

      await recover(dayStart, Date.now() + deadlineMs);
    });
  } catch (error) {
    console.error("[Market Price On-Demand Recovery] Failed", {
      deliveryDate,
      error,
    });
  }
}
