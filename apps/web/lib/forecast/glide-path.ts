/**
 * PV Generation Forecast — recent glide-path / bias correction.
 *
 * Where today's observed production already exists (the elapsed part of
 * the day, before the forecast horizon starts), compares it against what
 * the physical+weather+calibration model would have predicted for that
 * same elapsed window, and carries the resulting bias into the near-term
 * forecast horizon with a smooth linear decay to zero — never a step
 * function, so there is no artificial discontinuity right at "now" or at
 * the point the correction fully fades out.
 */

const DEFAULT_DECAY_HOURS = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

export type ObservedVsModelPoint = { actualKw: number; modelKw: number };

/**
 * `recentBias === 1` (no correction) whenever there isn't enough recent
 * daylight data to trust a bias estimate from — e.g. very early morning,
 * or a plant with a data gap. Never fabricated from too few samples.
 */
export function computeRecentBias(points: ObservedVsModelPoint[], minPhysicalKw = 2, minSamples = 3): number {
  const ratios = points.filter((p) => p.modelKw >= minPhysicalKw).map((p) => p.actualKw / p.modelKw);

  if (ratios.length < minSamples) {
    return 1;
  }

  return Math.min(1.6, Math.max(0.4, median(ratios)));
}

/** Linear decay from full correction at `now` to none at `now + decayHours` — continuous, no discontinuity. */
export function glidePathWeight(timestamp: Date, now: Date, decayHours: number = DEFAULT_DECAY_HOURS): number {
  const hoursAhead = (timestamp.getTime() - now.getTime()) / (60 * 60 * 1000);
  if (hoursAhead <= 0) {
    return 1;
  }
  if (hoursAhead >= decayHours) {
    return 0;
  }
  return 1 - hoursAhead / decayHours;
}

export function applyGlidePath(baseKw: number, timestamp: Date, now: Date, recentBias: number, decayHours: number = DEFAULT_DECAY_HOURS): number {
  const weight = glidePathWeight(timestamp, now, decayHours);
  const factor = 1 + weight * (recentBias - 1);
  return baseKw * factor;
}
