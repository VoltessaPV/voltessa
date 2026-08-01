import type { RunStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Platform Health & Operations Center milestone (Sections 4/10, Historical/
 * Import Health). The single shared write path for `ImporterRun` — each of
 * the three existing shared importer entry points
 * (`synchronizeFusionSolarConnection`, `refreshMarketPrices`,
 * `ensureHistoricalRangeAvailable`) calls this once per invocation, so every
 * caller of those functions (scheduled or on-demand) is captured
 * consistently. Best-effort: a logging failure must never turn a successful
 * import into a failed one, so failures here are swallowed and reported to
 * `console.error` only.
 */
export async function recordImporterRun(entry: {
  importerType: string;
  organizationId: string | null;
  connectionId?: string | null;
  startedAt: Date;
  status: RunStatus;
  rowsImported?: number;
  rowsSkipped?: number;
  rowsFailed?: number;
  errorMessage?: string | null;
  details?: unknown;
}): Promise<void> {
  try {
    await prisma.importerRun.create({
      data: {
        importerType: entry.importerType,
        organizationId: entry.organizationId,
        connectionId: entry.connectionId ?? null,
        startedAt: entry.startedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - entry.startedAt.getTime(),
        status: entry.status,
        rowsImported: entry.rowsImported ?? 0,
        rowsSkipped: entry.rowsSkipped ?? 0,
        rowsFailed: entry.rowsFailed ?? 0,
        errorMessage: entry.errorMessage ?? null,
        details: entry.details === undefined ? undefined : (entry.details as never),
      },
    });
  } catch (error) {
    console.error("[Importer Run] Failed to persist ImporterRun", { importerType: entry.importerType, error });
  }
}
