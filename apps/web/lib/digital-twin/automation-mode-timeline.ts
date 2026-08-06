import type { ExportMode } from "@/lib/automation/export-decision";
import { prisma } from "@/lib/prisma";

/**
 * Battery Simulation milestone. The only structured, queryable historical
 * curtailment signal in this codebase is `AutomationEvent` (`type:
 * "mode_changed"`) - created only on a real transition, never on every
 * scheduler tick (see that model's own schema doc comment). This
 * reconstructs a step-function timeline of which `ExportMode` was in effect
 * at any instant across `[start, end)`, for the Available PV
 * reconstruction step to consult.
 *
 * `AutomationEvent.organizationId` is not plant-scoped - correct today
 * because each organization automates exactly one plant (the same
 * assumption `AutomationState`/`AutomationSettings` already make). If a
 * second automated plant per organization is ever added, this needs a
 * plant-scoping fix at that point - not a V1 concern.
 */
export type AutomationModeTimelineEntry = {
  effectiveFrom: Date;
  mode: ExportMode;
};

function toExportMode(value: string | null): ExportMode | null {
  return value === "Zero Export" || value === "No Limit" ? value : null;
}

/**
 * Ordered ascending by `effectiveFrom`. The first entry always starts at
 * `start` itself, carrying whatever mode was already in effect at that
 * instant (the most recent `mode_changed` event before `start`, or
 * `"No Limit"` if automation never ran before `start` - the same "never
 * curtailed, production is trustworthy" default the reconstruction step
 * relies on).
 */
export async function getAutomationModeTimeline(
  organizationId: string,
  start: Date,
  end: Date,
): Promise<AutomationModeTimelineEntry[]> {
  const [priorEvent, eventsInRange] = await Promise.all([
    prisma.automationEvent.findFirst({
      where: { organizationId, type: "mode_changed", createdAt: { lt: start } },
      orderBy: { createdAt: "desc" },
      select: { newMode: true },
    }),
    prisma.automationEvent.findMany({
      where: { organizationId, type: "mode_changed", createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, newMode: true },
    }),
  ]);

  const timeline: AutomationModeTimelineEntry[] = [
    { effectiveFrom: start, mode: toExportMode(priorEvent?.newMode ?? null) ?? "No Limit" },
  ];

  for (const event of eventsInRange) {
    const mode = toExportMode(event.newMode);
    if (mode !== null) {
      timeline.push({ effectiveFrom: event.createdAt, mode });
    }
  }

  return timeline;
}

/** `timeline` must be sorted ascending by `effectiveFrom` (as `getAutomationModeTimeline` already returns it). */
export function isZeroExportAt(timeline: AutomationModeTimelineEntry[], instant: Date): boolean {
  let mode: ExportMode = "No Limit";

  for (const entry of timeline) {
    if (entry.effectiveFrom.getTime() > instant.getTime()) {
      break;
    }
    mode = entry.mode;
  }

  return mode === "Zero Export";
}
