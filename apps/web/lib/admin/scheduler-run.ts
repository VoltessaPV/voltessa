import type { RunStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Platform Health & Operations Center milestone (Section 5, Scheduler
 * Health). The single shared write path for `SchedulerRun` — every
 * `app/api/internal/**` route the Scaleway systemd timers call records its
 * own execution through this one function, so there is exactly one place
 * that decides what a "scheduler run" row looks like, not four slightly
 * different ones. Best-effort: a logging failure must never turn a
 * successful scheduler execution into a failed HTTP response, so failures
 * here are swallowed and reported to `console.error` only.
 */
export async function recordSchedulerRun(entry: {
  schedulerName: string;
  startedAt: Date;
  status: RunStatus;
  errorMessage?: string;
  summary?: unknown;
}): Promise<void> {
  try {
    await prisma.schedulerRun.create({
      data: {
        schedulerName: entry.schedulerName,
        startedAt: entry.startedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - entry.startedAt.getTime(),
        status: entry.status,
        errorMessage: entry.errorMessage ?? null,
        summary: entry.summary === undefined ? undefined : (entry.summary as never),
      },
    });
  } catch (error) {
    console.error("[Scheduler Run] Failed to persist SchedulerRun", { schedulerName: entry.schedulerName, error });
  }
}
