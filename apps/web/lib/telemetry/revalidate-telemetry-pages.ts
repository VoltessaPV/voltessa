import { revalidatePath } from "next/cache";

import type { TelemetryFreshnessResult } from "@/lib/fusionsolar/telemetry-sync-service";

/**
 * The one place that knows which routes render telemetry and therefore
 * need revalidating once a background synchronization actually wrote new
 * data. `ensureTelemetryFresh` deliberately returns a plain result instead
 * of performing this itself (see its own doc comment - cache invalidation
 * is a UI concern, not a synchronization concern).
 *
 * Used only by `mode: "background"` callers (Settings/Automations/Alerts/
 * Plants), via `onSettled` - by the time a background sync completes, the
 * request that triggered it has long since finished, so this is the only
 * remaining way to react to it. Dashboard/Market's own `mode: "blocking"`
 * calls don't use this: both routes are fully dynamic (never in the Full
 * Route Cache) with no client-side `staleTimes` override, so their own
 * data-loading already reads live database state without any invalidation
 * - see their page.tsx's own comment on this. If a future blocking caller
 * ever needs this, remember `revalidatePath` can't run directly during a
 * Server Component's own render - only from a Server Action, Route
 * Handler, or an `after()` continuation.
 */
export function revalidateTelemetryPagesIfSynced(result: TelemetryFreshnessResult): void {
  if (result === "synced") {
    revalidatePath("/dashboard");
    revalidatePath("/market");
  }
}
