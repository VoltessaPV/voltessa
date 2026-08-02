"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth/session";
import { importHistoricalRange } from "@/lib/historical-data/import-historical-range";
import { localDayBoundsUtc, localMonthBoundsUtc, localYearBoundsUtc } from "@/lib/market-price/timezone";
import { prisma } from "@/lib/prisma";

const BULGARIA_TIMEZONE = "Europe/Sofia";

/**
 * Database-First Architecture milestone. One chunk's time budget - the
 * route this Server Action runs on (`app/admin/historical-imports/page.tsx`)
 * is given a generous `maxDuration` (see `vercel.json`), and this stays
 * comfortably under it so the response always returns before Vercel would
 * ever kill the function. If a job's range isn't fully imported within one
 * chunk, it stays `PENDING` and the "Continue" action processes the next
 * chunk - idempotent and resumable, same as every other historical importer
 * call in this codebase.
 */
const CHUNK_TIME_BUDGET_MS = 230_000;

/** "Complete history" has no stored installation date to anchor to - a generous, clearly-arbitrary lower bound, not a claimed fact. Idempotent/no-op for any year with nothing to import. */
const COMPLETE_HISTORY_YEARS_BACK = 10;

async function processJobChunk(jobId: string): Promise<void> {
  const job = await prisma.historicalImportJob.findUniqueOrThrow({ where: { id: jobId } });

  await prisma.historicalImportJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });

  try {
    const outcome = await importHistoricalRange({
      organizationId: job.organizationId,
      start: job.rangeStart,
      end: job.rangeEnd,
      timeBudgetMs: CHUNK_TIME_BUDGET_MS,
    });

    await prisma.historicalImportJob.update({
      where: { id: jobId },
      data: {
        status: outcome.fullyComplete ? "COMPLETED" : "PENDING",
        daysRequested: outcome.daysRequested,
        daysAvailable: outcome.daysAvailable,
        lastRunAt: new Date(),
        lastError: null,
      },
    });
  } catch (error) {
    await prisma.historicalImportJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        lastRunAt: new Date(),
        lastError: error instanceof Error ? error.message : "unknown_error",
      },
    });
  }
}

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Platform Admin's explicit historical-import trigger - the only UI path
 * (besides the one-time onboarding import) allowed to start a Huawei/
 * ENTSO-E historical import. Creates the job, then immediately processes
 * its first chunk - a Platform Admin clicking "Import" expects to see a
 * real result, not a placeholder that only updates on a later poll.
 */
export async function createHistoricalImportJob(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();

  const organizationId = String(formData.get("organizationId") ?? "");
  const importType = String(formData.get("importType") ?? "month");

  if (!organizationId) {
    throw new Error("An organization must be selected.");
  }

  const now = new Date();
  const todayStart = localDayBoundsUtc(now, BULGARIA_TIMEZONE).start;

  let rangeStart: Date;
  let rangeEnd: Date = todayStart;

  if (importType === "year") {
    rangeStart = localYearBoundsUtc(now, BULGARIA_TIMEZONE).start;
  } else if (importType === "complete") {
    rangeStart = new Date(now);
    rangeStart.setUTCFullYear(rangeStart.getUTCFullYear() - COMPLETE_HISTORY_YEARS_BACK);
  } else if (importType === "custom") {
    const startParam = String(formData.get("rangeStart") ?? "");
    const endParam = String(formData.get("rangeEnd") ?? "");

    if (!isValidDateString(startParam) || !isValidDateString(endParam)) {
      throw new Error("A valid start and end date are required for a custom range.");
    }

    rangeStart = localDayBoundsUtc(new Date(`${startParam}T12:00:00Z`), BULGARIA_TIMEZONE).start;
    rangeEnd = localDayBoundsUtc(new Date(`${endParam}T12:00:00Z`), BULGARIA_TIMEZONE).end;
  } else {
    rangeStart = localMonthBoundsUtc(now, BULGARIA_TIMEZONE).start;
  }

  const job = await prisma.historicalImportJob.create({
    data: {
      organizationId,
      rangeStart,
      rangeEnd,
      status: "PENDING",
      createdByUserId: admin.id,
    },
  });

  await processJobChunk(job.id);

  revalidatePath("/admin/historical-imports");
}

/** Processes the next chunk of an existing, not-yet-complete job - resumable, idempotent, zero cost for whatever's already imported. */
export async function continueHistoricalImportJob(jobId: string): Promise<void> {
  await requirePlatformAdmin();
  await processJobChunk(jobId);
  revalidatePath("/admin/historical-imports");
}
