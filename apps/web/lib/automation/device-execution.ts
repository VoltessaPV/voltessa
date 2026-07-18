/**
 * Voltessa Automation — Device Execution Layer (placeholder).
 *
 * This is the boundary where a business decision (see
 * `lib/automation/export-decision.ts`) would eventually be turned into a
 * real command sent to a real device backend. Huawei is only one possible
 * execution backend behind this boundary, not the boundary itself — this
 * module defines its own command vocabulary rather than importing the
 * Decision Engine's `ExportDecisionAction`, so the two stay independently
 * defined and loosely coupled.
 *
 * This milestone builds the architecture only: `sendExportCommand` is a
 * placeholder that never calls any real API. Nothing in this codebase
 * calls it yet — not the Decision Engine, not any route, not any cron.
 *
 * Wiring this to the real, already-built Huawei helpers
 * (`lib/fusionsolar/export-control.ts`'s `setExportLimit`/`restoreExport`)
 * is explicit future work, not done here — see
 * `docs/research/fusionsolar-active-power-control.md` for the current,
 * canonical state of that capability.
 */

export type ExportCommand = "LIMIT_EXPORT" | "REMOVE_LIMIT";

export type ExportCommandResult = {
  executed: boolean;
  reason: string;
};

/**
 * Placeholder only. Never calls a real device API.
 */
export async function sendExportCommand(
  command: ExportCommand,
): Promise<ExportCommandResult> {
  return {
    executed: false,
    reason: `Device execution layer not yet implemented (requested command: ${command}).`,
  };
}
