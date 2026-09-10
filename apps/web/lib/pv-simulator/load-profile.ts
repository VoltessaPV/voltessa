/**
 * PV Simulator — customer load-profile ingestion & validation.
 *
 * Accepts the parsed rows of the uploaded `.xlsx` (a `read-excel-file`
 * `SheetData` — `(string | number | boolean | Date | null)[][]`) and turns
 * them into a validated, ordered list of 15-minute intervals. Pure: the
 * Server Action does the `readSheet(...)` I/O and hands the rows here, so
 * every rule below is unit-tested without a real file.
 *
 * ## Expected layout ("pivot" / matrix)
 *
 * The observed real file (`OB Load profile_202605.xlsx`, sheet
 * "Hourly data") is:
 *
 *   row 0 : [ <empty> , 00:15 , 00:30 , … , 23:45 , 24:00 ]   ← 96 interval-END time-of-day headers
 *   row n : [ <date>  , v1    , v2    , … , v95   , v96   ]   ← one calendar day, 96 values
 *
 * Column `j` (1…96) is the interval **ending** at `j × 15` minutes after
 * local midnight, i.e. **starting** at `(j−1) × 15` minutes. Header time
 * cells arrive as `Date` objects (Excel epoch); the 96th is Excel's
 * `1899-12-31 00:00` = 24:00.
 *
 * ## Units
 *
 * `unitMode: "kwh_interval"` (default) — each value is energy in **kWh for
 * that 15-minute interval**. Confirmed for the real file: its cell at
 * (2026-05-01, interval-end 09:15) is `60`, matching the specification's
 * worked example "01.05.2026 09:15 → 60 kWh".
 * `unitMode: "kw_average"` — each value is **average power in kW** over the
 * interval; converted to interval energy as `kWh = kW × 0.25`.
 *
 * ## Timezone / DST / leap years
 *
 * The file carries no timezone. Values are civil wall-clock in the
 * reference plant's timezone (`Europe/Sofia` for Chomakovtsi — the customer
 * is Bulgarian). Each interval's real instant is
 * `zonedTimeToUtc(y, m, d, startHH, startMM, timeZone)` (DST-exact,
 * `Intl`-based; see `lib/market-price/timezone.ts`). The grid is 96 nominal
 * slots per calendar day regardless of DST — the standard utility export
 * convention:
 *   - spring-forward day (local day is 23 h): the source leaves the last
 *     hour's 4 cells blank → they become `missing_load`; the non-existent
 *     02:00–03:00 local slots produce colliding UTC instants → flagged
 *     `dst_ambiguous`, first kept, later dropped, all counted & reported.
 *   - fall-back day (local day is 25 h): the source has only 96 slots, so
 *     the repeated hour is represented once; reported as `dstShortDays`.
 *   - Feb 29 simply is or isn't a row; nothing special is assumed.
 *
 * ## Data-integrity rules (all surfaced as `errors` / `warnings`)
 *
 * fatal (`errors`, no result): no data rows; wrong column count; a
 * non-date first cell on a data row; a non-numeric, non-blank value cell;
 * a negative value; every value blank.
 * non-fatal (`warnings`, result still returned): blank cells (missing
 * intervals); duplicate calendar dates (later row wins, both reported);
 * date gaps (missing days); DST ambiguity/short days; a suspiciously
 * power-shaped profile when `unitMode` is `kwh_interval`.
 */

import { zonedTimeToUtc } from "@/lib/market-price/timezone";
import { formatWallClockTimestamp } from "@/lib/reporting/export-shared";

import type { SimulationInputInterval } from "./simulate";

export type LoadProfileUnitMode = "kwh_interval" | "kw_average";

export type LoadProfileWarning = { code: string; message: string };

export type LoadProfileParseResult =
  | { ok: false; errors: string[]; warnings: LoadProfileWarning[] }
  | {
      ok: true;
      warnings: LoadProfileWarning[];
      timeZone: string;
      unitMode: LoadProfileUnitMode;
      /** Ordered, de-duplicated 15-minute intervals with `referencePvKwh` left null (filled by `generate-simulation.ts`). */
      intervals: SimulationInputInterval[];
      /** Distinct calendar days present, ascending `YYYY-MM-DD`. */
      days: string[];
      firstIntervalStartUtc: Date;
      /** Exclusive — the instant just after the last interval. */
      lastIntervalEndUtc: Date;
      counts: {
        rows: number;
        intervals: number;
        blankCells: number;
        duplicateDates: number;
        dateGaps: number;
        dstAmbiguous: number;
      };
    };

type SheetCell = string | number | boolean | Date | null | undefined;
export type SheetRows = SheetCell[][];

const INTERVALS_PER_DAY = 96;
const STEP_MIN = 15;

function isDate(v: unknown): v is Date {
  return v instanceof Date && !Number.isNaN(v.getTime());
}

/** Header time cell → minutes-after-midnight of the interval END (0 is treated as 24:00 / 1440). */
function headerEndMinutes(cell: SheetCell, columnIndex: number): number | null {
  if (isDate(cell)) {
    const mins = cell.getUTCHours() * 60 + cell.getUTCMinutes();
    // Excel serial for 24:00 is a date one day later at 00:00 → mins === 0.
    return mins === 0 ? 24 * 60 : mins;
  }
  if (typeof cell === "string") {
    const m = /^(\d{1,2}):(\d{2})$/.exec(cell.trim());
    if (m) {
      const mins = Number(m[1]) * 60 + Number(m[2]);
      return mins === 0 ? 24 * 60 : mins;
    }
  }
  if (typeof cell === "number" && Number.isFinite(cell)) {
    // Excel time fraction of a day.
    const mins = Math.round(cell * 24 * 60);
    return mins === 0 ? 24 * 60 : mins;
  }
  // Fall back to positional assumption: column j ends at j*15 min.
  return columnIndex >= 1 && columnIndex <= INTERVALS_PER_DAY ? columnIndex * STEP_MIN : null;
}

function toDateOnly(cell: SheetCell): { y: number; m: number; d: number } | null {
  if (isDate(cell)) {
    return { y: cell.getUTCFullYear(), m: cell.getUTCMonth() + 1, d: cell.getUTCDate() };
  }
  if (typeof cell === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(cell.trim());
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    const m2 = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(cell.trim());
    if (m2) return { y: Number(m2[3]), m: Number(m2[2]), d: Number(m2[1]) };
  }
  return null;
}

export function parseLoadProfile(
  rows: SheetRows,
  options: { timeZone: string; unitMode?: LoadProfileUnitMode },
): LoadProfileParseResult {
  const warnings: LoadProfileWarning[] = [];
  const errors: string[] = [];
  const timeZone = options.timeZone;
  const unitMode: LoadProfileUnitMode = options.unitMode ?? "kwh_interval";

  if (!Array.isArray(rows) || rows.length < 2) {
    return { ok: false, errors: ["The sheet has no data rows."], warnings };
  }

  const header = rows[0] ?? [];
  const dataRows = rows.slice(1).filter((r) => Array.isArray(r) && r.some((c) => c !== null && c !== undefined && c !== ""));
  if (dataRows.length === 0) {
    return { ok: false, errors: ["The sheet has no data rows."], warnings };
  }

  // Resolve the 96 interval-end minute marks from the header, or fall back to positional.
  const endMinutes: number[] = [];
  for (let j = 1; j <= INTERVALS_PER_DAY; j += 1) {
    const mins = headerEndMinutes(header[j], j);
    if (mins === null) {
      errors.push(
        `The header row does not describe 96 fifteen-minute columns (column ${j + 1} is unreadable).`,
      );
      break;
    }
    endMinutes.push(mins);
  }
  if (errors.length > 0) return { ok: false, errors, warnings };
  if (endMinutes[endMinutes.length - 1] !== 24 * 60 || endMinutes[0] !== STEP_MIN) {
    warnings.push({
      code: "header_grid",
      message: `Interval-end headers span ${endMinutes[0]}…${endMinutes[endMinutes.length - 1]} minutes; expected 15…1440. Falling back to a fixed 15-minute grid.`,
    });
  }

  const seenDates = new Map<string, number>(); // yyyy-mm-dd -> first row index
  const utcSeen = new Map<number, number>(); // interval-start UTC ms -> count
  const intervals: SimulationInputInterval[] = [];
  const dayset = new Set<string>();
  let blankCells = 0;
  let duplicateDates = 0;
  let dstAmbiguous = 0;
  let anyValue = false;

  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i]!;
    const date = toDateOnly(row[0]);
    if (!date) {
      errors.push(`Row ${i + 2}: the first cell is not a valid date (got ${JSON.stringify(row[0] ?? null)}).`);
      continue;
    }
    if (row.length < INTERVALS_PER_DAY + 1) {
      errors.push(
        `Row ${i + 2} (${date.y}-${pad(date.m)}-${pad(date.d)}): expected ${INTERVALS_PER_DAY} value columns, found ${Math.max(row.length - 1, 0)}.`,
      );
      continue;
    }
    const dayKey = `${date.y}-${pad(date.m)}-${pad(date.d)}`;
    if (seenDates.has(dayKey)) {
      duplicateDates += 1;
      warnings.push({
        code: "duplicate_date",
        message: `Date ${dayKey} appears more than once (rows ${seenDates.get(dayKey)! + 2} and ${i + 2}); the later row is used.`,
      });
      // Remove the earlier day's intervals (and their instant-dedup marks) so the later row wins.
      for (let k = intervals.length - 1; k >= 0; k -= 1) {
        if (intervals[k]!.localLabel.slice(0, 10) !== dayKey) continue;
        utcSeen.delete(intervals[k]!.intervalStartUtc.getTime());
        intervals.splice(k, 1);
      }
    }
    seenDates.set(dayKey, i);
    dayset.add(dayKey);

    for (let j = 1; j <= INTERVALS_PER_DAY; j += 1) {
      const raw = row[j];
      const endMin = endMinutes[j - 1]!;
      const startMin = endMin - STEP_MIN;
      const startHH = Math.floor(startMin / 60);
      const startMM = startMin % 60;
      const startUtc = zonedTimeToUtc(date.y, date.m, date.d, startHH, startMM, timeZone);
      const localLabel = formatWallClockTimestamp(startUtc, timeZone);

      let loadKwh: number | null;
      if (raw === null || raw === undefined || raw === "") {
        loadKwh = null;
        blankCells += 1;
      } else if (typeof raw === "number" && Number.isFinite(raw)) {
        if (raw < 0) {
          errors.push(`Row ${i + 2} (${dayKey}), column ${j + 1}: negative value ${raw}.`);
          continue;
        }
        anyValue = true;
        loadKwh = unitMode === "kw_average" ? raw * 0.25 : raw;
      } else if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
        const n = Number(raw.trim());
        if (n < 0) {
          errors.push(`Row ${i + 2} (${dayKey}): negative value ${raw}.`);
          continue;
        }
        anyValue = true;
        loadKwh = unitMode === "kw_average" ? n * 0.25 : n;
      } else {
        errors.push(
          `Row ${i + 2} (${dayKey}), column ${j + 1}: value ${JSON.stringify(raw)} is not a number.`,
        );
        continue;
      }

      const ms = startUtc.getTime();
      const prior = utcSeen.get(ms) ?? 0;
      utcSeen.set(ms, prior + 1);
      if (prior > 0) {
        // A DST spring-forward collision (the non-existent local hour maps onto an existing instant).
        dstAmbiguous += 1;
        warnings.push({
          code: "dst_ambiguous",
          message: `${dayKey} ${localLabel.slice(11)}: this local time does not exist (spring-forward) — the interval is flagged and excluded to avoid a duplicate.`,
        });
        continue;
      }

      intervals.push({
        intervalStartUtc: startUtc,
        localLabel,
        loadKwh,
        referencePvKwh: null,
        inputQuality: "ok",
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  if (!anyValue) {
    return { ok: false, errors: ["Every value cell in the profile is blank."], warnings };
  }

  intervals.sort((a, b) => a.intervalStartUtc.getTime() - b.intervalStartUtc.getTime());

  // Gap detection across calendar days (UTC-midnight arithmetic on the plain YYYY-MM-DD keys).
  const days = [...dayset].sort();
  let dateGaps = 0;
  for (let k = 1; k < days.length; k += 1) {
    const p = new Date(`${days[k - 1]}T00:00:00Z`).getTime();
    const c = new Date(`${days[k]}T00:00:00Z`).getTime();
    const deltaDays = Math.round((c - p) / 86_400_000);
    if (deltaDays !== 1) {
      dateGaps += deltaDays - 1;
      warnings.push({
        code: "date_gap",
        message: `${deltaDays - 1} missing day(s) between ${days[k - 1]} and ${days[k]}.`,
      });
    }
  }

  // Cheap "is this actually kW, not kWh?" heuristic when the caller said kWh.
  if (unitMode === "kwh_interval") {
    const withValue = intervals.filter((iv) => iv.loadKwh !== null);
    if (withValue.length > 0) {
      const meanPerInterval =
        withValue.reduce((s, iv) => s + (iv.loadKwh ?? 0), 0) / withValue.length;
      // A 15-minute interval energy that averages > 250 kWh implies > 1 MW average draw,
      // which is far more likely a kW figure that was mis-labelled as kWh.
      if (meanPerInterval > 250) {
        warnings.push({
          code: "possible_kw_input",
          message: `Mean value per 15-minute interval is ${meanPerInterval.toFixed(1)}; if the file is average power (kW) rather than interval energy (kWh), re-run with the kW option.`,
        });
      }
    }
  }

  const first = intervals[0]!.intervalStartUtc;
  const last = new Date(intervals[intervals.length - 1]!.intervalStartUtc.getTime() + STEP_MIN * 60000);

  if (blankCells > 0) {
    warnings.push({
      code: "missing_intervals",
      message: `${blankCells} interval(s) have no value and are excluded from all totals (not treated as 0).`,
    });
  }

  return {
    ok: true,
    warnings,
    timeZone,
    unitMode,
    intervals,
    days,
    firstIntervalStartUtc: first,
    lastIntervalEndUtc: last,
    counts: {
      rows: dataRows.length,
      intervals: intervals.length,
      blankCells,
      duplicateDates,
      dateGaps,
      dstAmbiguous,
    },
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
