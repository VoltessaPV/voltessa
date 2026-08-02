import { importHistoricalRange } from "@/lib/historical-data/import-historical-range";
import { localDayBoundsUtc, localMonthBoundsUtc, previousPeriodBoundsUtc } from "@/lib/market-price/timezone";

const BULGARIA_TIMEZONE = "Europe/Sofia";

/**
 * Database-First Architecture milestone. The one automatic historical
 * import in the whole application — fired exactly once, right after a
 * `FusionSolarConnection` is first created for an organization (see the
 * OAuth callback route), never on a reconnect/token-refresh of an existing
 * connection. Gives every new customer meaningful historical context
 * without attempting to import the plant's entire history:
 *
 * - from the 1st of the previous calendar month
 * - through yesterday (today itself is kept fresh by the live
 *   telemetry-ingestion scheduler and login-triggered sync, never by a
 *   historical import — same convention `enumerateApplicableDays`
 *   already uses everywhere else in this codebase).
 *
 * Anything older than this is available on demand via Platform Admin's
 * historical-import tools (`app/admin/operations/historical-imports`),
 * never automatically.
 */
export async function runOnboardingHistoricalImport(
  organizationId: string,
  timeBudgetMs: number,
): Promise<void> {
  const now = new Date();
  const { start: currentMonthStart } = localMonthBoundsUtc(now, BULGARIA_TIMEZONE);
  const { start: previousMonthStart } = previousPeriodBoundsUtc("month", currentMonthStart, BULGARIA_TIMEZONE);
  const { start: todayStart } = localDayBoundsUtc(now, BULGARIA_TIMEZONE);

  try {
    const outcome = await importHistoricalRange({
      organizationId,
      start: previousMonthStart,
      end: todayStart,
      timeBudgetMs,
    });

    console.log("[Onboarding Historical Import] Completed", { organizationId, ...outcome });
  } catch (error) {
    console.error("[Onboarding Historical Import] Failed unexpectedly", { organizationId, error });
  }
}
