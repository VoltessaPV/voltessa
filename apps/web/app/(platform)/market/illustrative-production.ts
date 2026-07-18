/**
 * Illustrative-only solar production curve, used solely to give the
 * Revenue card a plausible export volume to multiply real ENTSO-E prices
 * by. There is no real production data source wired into the Market page
 * yet — that is FusionSolar telemetry (`lib/fusionsolar/*`), explicit
 * future work per this milestone's architecture goals. Every price this
 * curve is multiplied by is real; the curve itself is not, and every
 * caller of this module must surface that distinction to the user rather
 * than presenting the resulting revenue as fully real.
 */

const ASSUMED_PLANT_CAPACITY_MW = 5;

/**
 * A deterministic bell curve peaking at solar noon and zero overnight,
 * shaped like a real PV output profile — but not read from any real
 * inverter or telemetry source.
 */
export function estimateIllustrativeProductionMw(
  timestamp: Date,
  timeZone: string,
): number {
  const hour = getLocalHour(timestamp, timeZone);
  const daylight = Math.max(0, Math.sin(((hour - 5) / 14) * Math.PI));

  return Math.round(daylight * ASSUMED_PLANT_CAPACITY_MW * 100) / 100;
}

function getLocalHour(timestamp: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );

  return hour + minute / 60;
}
