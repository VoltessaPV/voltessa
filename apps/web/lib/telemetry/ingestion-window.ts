import { localHourInZone } from "@/lib/market-price/timezone";

/**
 * Genuine-Vintage Completeness Correction milestone (Aug 2026). The single
 * authoritative definition of Voltessa's shared telemetry ingestion
 * window — `voltessa-telemetry-ingestion.timer` fires every 15 minutes,
 * daily 06:00–22:00 Europe/Sofia (see
 * `docs/infrastructure/scaleway-production.md`; also referenced in prose,
 * not as a shared constant, by `lib/fusionsolar/telemetry-sync-service.ts`
 * and `app/api/internal/fusionsolar/bootstrap-device-telemetry/route.ts` —
 * this module is the first place it's centralized as an actual value).
 * The SAME window applies to every plant — the scheduler is shared, not
 * plant-specific, and nothing in this codebase branches on plant identity
 * for it.
 *
 * PV production is structurally zero outside this window, so telemetry is
 * intentionally never pulled for those hours — a deliberate architecture
 * decision, not a data gap. Anything that computes an "expected number of
 * intervals per day" against real production/telemetry data (e.g. genuine-
 * vintage eligibility, `lib/forecast/ml/genuine-vintage.ts`) must derive
 * it from here, never hardcode 96 (a full calendar day) or a separately-
 * chosen daytime-hour literal — so that changing the ingestion window in
 * the future automatically changes every dependent calculation.
 *
 * This module does NOT change telemetry ingestion behavior itself — the
 * actual scheduled sync (`bootstrap-device-telemetry`) is still controlled
 * entirely by the systemd timer's own `OnCalendar` on the Scaleway VM,
 * outside this repository. This is a read-only, derived description of
 * that existing, unmodified schedule, for use by code that needs to know
 * "how many production intervals are genuinely expected in a day."
 */

const INGESTION_TIMEZONE = "Europe/Sofia";
const INGESTION_WINDOW_START_HOUR = 6;
const INGESTION_WINDOW_END_HOUR = 22;
const INTERVALS_PER_HOUR = 4; // 15-minute resolution, matching PvForecastRecord/DeviceTelemetry's native grid.

/** Total 15-minute intervals per calendar day within the shared ingestion window (06:00-22:00 Sofia = 16h = 64). */
export const EXPECTED_PRODUCTION_INTERVALS_PER_DAY = (INGESTION_WINDOW_END_HOUR - INGESTION_WINDOW_START_HOUR) * INTERVALS_PER_HOUR;

/**
 * Whether `instant` falls within the shared ingestion window, in Sofia
 * local time (DST-aware via `localHourInZone`). Nighttime instants
 * (outside this window) are intentionally excluded here — they must never
 * count toward OR against any completeness calculation built on top of
 * this module, for any plant.
 */
export function isWithinIngestionWindow(instant: Date): boolean {
  const hour = localHourInZone(instant, INGESTION_TIMEZONE);
  return hour >= INGESTION_WINDOW_START_HOUR && hour < INGESTION_WINDOW_END_HOUR;
}
