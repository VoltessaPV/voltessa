/**
 * Market-price operational alerting (Market Price Reliability milestone;
 * this file's second iteration corrects the first, "morning check" design -
 * recovery starts immediately when the 14:00 primary import fails/produces
 * an incomplete dataset, not at a fixed morning check time; 05:00
 * Europe/Sofia is only a hard ESCALATION deadline for an incident already
 * open since the afternoon before). Reuses the existing generic
 * notification-provider abstraction (`lib/notifications/provider.ts`,
 * `ntfyNotificationProvider`) already live in production for automation
 * alerts (`lib/notifications/automation-notifications.ts`) - no new
 * external provider/account/credentials, same free keyless ntfy.sh topic.
 * This module owns a separate concern (market-price import/recovery
 * health, not per-plant automation events), so it calls the shared
 * provider directly rather than extending
 * `automation-notifications.ts`'s Atlanta-specific event types.
 *
 * Incident semantics: a scheduled run's outcome only ever produces a
 * notification on a STATUS TRANSITION - never once per retry. This is what
 * prevents alert spam from a multi-hour outage retried every 30 minutes
 * (`classifyIncident` below), while still surfacing an incident opening,
 * an incident resolving, AND - new in this iteration - a single CRITICAL
 * escalation if the incident is still open once the hard recovery deadline
 * passes (never repeated on every retry after that point either).
 */

import { prisma } from "@/lib/prisma";
import type { Notification } from "@/lib/notifications/provider";
import { ntfyNotificationProvider } from "@/lib/notifications/providers/ntfy";

/**
 * `SKIPPED` is ENTSO-E's documented "not published yet" response (see
 * `EntsoeNoDataAvailableError`) - routine, especially in the first retry
 * cycles right after 14:00, and deliberately NEVER treated as a failure on
 * its own (see `classifyIncident`) so the normal "ENTSO-E publishes a few
 * minutes after 14:00 most days" pattern never opens/closes a false
 * incident. Only once the hard deadline has passed does a still-`SKIPPED`
 * result stop being routine and start counting toward escalation, exactly
 * like a real `FAILED` result would.
 */
export type MarketPriceRunStatus = "SUCCESS" | "SKIPPED" | "FAILED";

export type MarketPriceIncidentContext = {
  deliveryDate: string;
  source: string;
  expectedIntervals: number | null;
  importedIntervals: number | null;
  reason: string | null;
  /** IBEX Fallback milestone: which source was tried first - always "ENTSOE" today, kept explicit rather than assumed. */
  primarySource?: string;
  fallbackAttempted?: boolean;
  fallbackSource?: string | null;
  /** IBEX Fallback milestone: how the delivery day was ultimately (or not yet) resolved. */
  finalStatus?: "primary" | "fallback" | "failed";
  consecutiveFailures?: number;
  /** Wall-clock time since the incident first opened, for the "recovered" and "escalated" alerts. */
  incidentDurationMs?: number;
};

export type MarketPriceRunRecord = { status: MarketPriceRunStatus; startedAt: Date };

export type IncidentAction = "none" | "opened" | "closed" | "escalated";

/**
 * Pure incident classifier. `recentRunsDesc` is every prior run for this
 * scheduler, most-recent-first, NOT including `current` (the run that just
 * finished). `deadline` is the hard escalation instant for the specific
 * delivery day `current` is about, or `null` when this scheduler has no
 * deadline concept (not used by the primary import today, but keeps this
 * function reusable).
 *
 * - SUCCESS after a run that wasn't already failing -> "none" (nothing to report).
 * - SUCCESS after FAILED -> "closed" (incident resolved).
 * - SKIPPED or FAILED, previous run wasn't FAILED -> "opened" UNLESS this
 *   is a routine SKIPPED before the deadline (see below).
 * - SKIPPED/FAILED continuing an already-open incident, still before the
 *   deadline -> "none" (no spam - this is what makes a multi-hour retry
 *   loop silent).
 * - SKIPPED/FAILED continuing an already-open incident, past the deadline,
 *   and no run in the streak has already crossed the deadline -> "escalated"
 *   (fires exactly once per incident, no matter how many more retries
 *   happen after it).
 * - Anything else past the deadline (already escalated once) -> "none".
 */
export function classifyIncident(
  recentRunsDesc: MarketPriceRunRecord[],
  current: MarketPriceRunRecord,
  deadline: Date | null,
): IncidentAction {
  const previousStatus = recentRunsDesc[0]?.status ?? null;
  const previousWasFailing = previousStatus === "FAILED" || previousStatus === "SKIPPED";

  if (current.status === "SUCCESS") {
    return previousWasFailing ? "closed" : "none";
  }

  const pastDeadline = deadline !== null && current.startedAt >= deadline;

  // A routine "not published yet" before the deadline is never incident-worthy.
  if (current.status === "SKIPPED" && !pastDeadline) {
    return "none";
  }

  if (!previousWasFailing) {
    return "opened";
  }

  if (!pastDeadline) {
    return "none";
  }

  const alreadyEscalated = recentRunsDesc.some(
    (run) => (run.status === "FAILED" || run.status === "SKIPPED") && deadline !== null && run.startedAt >= deadline,
  );

  return alreadyEscalated ? "none" : "escalated";
}

/** Pure: counts the leading run of FAILED/SKIPPED statuses in a most-recent-first list (bounded by however many the caller fetched). */
export function countConsecutiveFailures(recentStatusesDesc: MarketPriceRunStatus[]): number {
  let count = 0;

  for (const status of recentStatusesDesc) {
    if (status !== "FAILED" && status !== "SKIPPED") {
      break;
    }

    count += 1;
  }

  return count;
}

/**
 * Pure: the OLDEST run in the leading FAILED/SKIPPED streak of a
 * most-recent-first list - i.e. "when this incident first opened," bounded
 * by however many runs the caller fetched. `undefined` when the most
 * recent run wasn't already failing (no open incident to date).
 */
function findIncidentStart(recentRunsDesc: MarketPriceRunRecord[]): MarketPriceRunRecord | undefined {
  let incidentStart: MarketPriceRunRecord | undefined;

  for (const run of recentRunsDesc) {
    if (run.status !== "FAILED" && run.status !== "SKIPPED") {
      break;
    }

    incidentStart = run;
  }

  return incidentStart;
}

function formatDurationMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatContextLines(ctx: MarketPriceIncidentContext): string[] {
  const lines = [`Delivery date: ${ctx.deliveryDate}`, `Source: ${ctx.source}`];

  if (ctx.expectedIntervals !== null && ctx.importedIntervals !== null) {
    lines.push(`Intervals: ${ctx.importedIntervals}/${ctx.expectedIntervals}`);
  }

  if (ctx.consecutiveFailures !== undefined) {
    lines.push(`Consecutive failed attempts: ${ctx.consecutiveFailures}`);
  }

  if (ctx.incidentDurationMs !== undefined) {
    lines.push(`Incident duration: ${formatDurationMs(ctx.incidentDurationMs)}`);
  }

  if (ctx.primarySource) {
    lines.push(`Primary source: ${ctx.primarySource}`);
  }

  lines.push(`Fallback attempted: ${ctx.fallbackAttempted ? (ctx.fallbackSource ?? "yes") : "no"}`);

  if (ctx.finalStatus) {
    lines.push(`Final status: ${ctx.finalStatus}`);
  }

  if (ctx.reason) {
    lines.push(`Reason: ${ctx.reason}`);
  }

  return lines;
}

async function send(notification: Notification): Promise<void> {
  try {
    await ntfyNotificationProvider.send(notification);
  } catch (error) {
    console.error("[Market Price Alerts] Failed to send notification", { error });
  }
}

export async function notifyMarketPriceImportFailed(ctx: MarketPriceIncidentContext): Promise<void> {
  await send({
    title: "Voltessa — Bulgaria day-ahead prices import failed",
    priority: "high",
    tags: ["warning", "chart_with_downwards_trend"],
    body: ["🔴 Bulgaria day-ahead price import failed", "", ...formatContextLines(ctx)].join("\n"),
  });
}

export async function notifyMarketPriceRecovered(ctx: MarketPriceIncidentContext): Promise<void> {
  await send({
    title: "Voltessa — Bulgaria day-ahead prices recovered",
    priority: "default",
    tags: ["green_circle", "chart_with_upwards_trend"],
    body: ["🟢 Bulgaria day-ahead price import recovered", "", ...formatContextLines(ctx)].join("\n"),
  });
}

/**
 * Fires at most once per incident, only after the hard recovery deadline
 * passes while still incomplete - see `classifyIncident`'s "escalated"
 * branch. Distinct from `notifyMarketPriceImportFailed` (which already
 * fired hours earlier when the incident opened): this is the CRITICAL,
 * "operations starts soon and we still don't have prices" signal.
 */
export async function notifyMarketPriceRecoveryWindowExhausted(ctx: MarketPriceIncidentContext): Promise<void> {
  await send({
    title: "Voltessa — CRITICAL: Bulgaria day-ahead prices still missing",
    priority: "high",
    tags: ["rotating_light", "warning"],
    body: [
      "🚨 Recovery window exhausted - today's Bulgaria day-ahead prices are still not complete",
      "",
      ...formatContextLines(ctx),
    ].join("\n"),
  });
}

/**
 * DB-touching glue: given a scheduler's freshly-finished outcome (not yet
 * recorded as a `SchedulerRun` row - callers must invoke this BEFORE
 * `recordSchedulerRun`, so the "previous runs" read below doesn't see the
 * current run), decides open/closed/escalated/none via `classifyIncident`
 * and sends the matching alert. Never throws - a notification-path problem
 * must never fail the caller's own scheduled run.
 */
export async function reportSchedulerOutcome(
  schedulerName: string,
  outcome: { status: MarketPriceRunStatus; startedAt?: Date } & MarketPriceIncidentContext,
  deadline: Date | null,
  notifiers: {
    onOpened?: (ctx: MarketPriceIncidentContext) => Promise<void>;
    onClosed?: (ctx: MarketPriceIncidentContext) => Promise<void>;
    onEscalated?: (ctx: MarketPriceIncidentContext) => Promise<void>;
  } = {},
): Promise<void> {
  const onOpened = notifiers.onOpened ?? notifyMarketPriceImportFailed;
  const onClosed = notifiers.onClosed ?? notifyMarketPriceRecovered;
  const onEscalated = notifiers.onEscalated ?? notifyMarketPriceRecoveryWindowExhausted;

  try {
    // Bounded to 50, not unbounded - comfortably more than the ~30 retries
    // a full 14:00-05:00 recovery window would produce even at a 30-minute
    // cadence, so incident-start/duration stays accurate for any realistic
    // incident length without ever scanning full table history.
    const recent = await prisma.schedulerRun.findMany({
      where: { schedulerName },
      orderBy: { startedAt: "desc" },
      take: 50,
      select: { status: true, startedAt: true },
    });

    const recentRuns: MarketPriceRunRecord[] = recent.map((run) => ({
      status: run.status as MarketPriceRunStatus,
      startedAt: run.startedAt,
    }));
    const current: MarketPriceRunRecord = {
      status: outcome.status,
      startedAt: outcome.startedAt ?? new Date(),
    };

    const action = classifyIncident(recentRuns, current, deadline);
    const consecutiveFailures = countConsecutiveFailures(recentRuns.map((run) => run.status)) + 1;

    if (action === "opened") {
      await onOpened({ ...outcome, consecutiveFailures });
    } else if (action === "closed" || action === "escalated") {
      const incidentStart = findIncidentStart(recentRuns);
      const incidentDurationMs = incidentStart
        ? current.startedAt.getTime() - incidentStart.startedAt.getTime()
        : undefined;

      if (action === "closed") {
        await onClosed({ ...outcome, incidentDurationMs });
      } else {
        await onEscalated({ ...outcome, consecutiveFailures, incidentDurationMs });
      }
    }
  } catch (error) {
    console.error("[Market Price Alerts] Failed to evaluate/send incident notification", {
      schedulerName,
      error,
    });
  }
}
