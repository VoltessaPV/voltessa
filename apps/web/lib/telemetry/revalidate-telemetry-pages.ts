import { revalidatePath } from "next/cache";

import type { TelemetryFreshnessResult } from "@/lib/fusionsolar/telemetry-sync-service";

/**
 * The one place that knows which routes render telemetry and therefore
 * need revalidating once a background synchronization actually wrote new
 * data. `ensureTelemetryFresh` deliberately returns a plain result instead
 * of performing this itself (see its own doc comment - cache invalidation
 * is a UI concern, not a synchronization concern).
 *
 * Used by every `mode: "background"` caller (Settings/Automations/Alerts/
 * Plants, and - since the Live Telemetry Synchronization Redesign
 * milestone - Dashboard/Market too), via `onSettled` - by the time a
 * background sync completes, the request that triggered it has long since
 * finished, so this is the only remaining way to react to it. Dashboard/
 * Market are already fully dynamic (never in the Full Route Cache) with no
 * client-side `staleTimes` override, so a plain reload always reads live
 * database state regardless; this revalidation just means an already-open
 * tab's next navigation reflects a just-recovered sync without the user
 * needing to hard-refresh. `revalidatePath` can't run directly during a
 * Server Component's own render - only from a Server Action, Route
 * Handler, or (as here) an `after()` continuation, which is why this is
 * plumbed through `onSettled` rather than called inline.
 */
export function revalidateTelemetryPagesIfSynced(result: TelemetryFreshnessResult): void {
  if (result === "synced") {
    revalidatePath("/dashboard");
    revalidatePath("/market");
  }
}
