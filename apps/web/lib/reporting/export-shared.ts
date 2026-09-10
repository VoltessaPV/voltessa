/**
 * Shared, feature-agnostic export primitives for admin analytical exporters
 * (the Reporting feature and the PV Self-Consumption Simulator). Extracted
 * from Reporting's `csv.ts` / `serialize.ts` so both features produce
 * byte-identical CSV framing and use one XLSX builder rather than a
 * parallel export architecture.
 *
 * Pure. No feature-specific types.
 */

import writeXlsxFile from "write-excel-file/node";

const BOM = String.fromCharCode(0xfeff);
const EOL = "\r\n";

/** RFC 4180 field quoting: wrap in `"` when the field contains `,` `"` CR or LF; double embedded `"`. */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * A complete CSV document from a matrix of already-stringified cells:
 * UTF-8 BOM (so Excel opens it as UTF-8), `\r\n` line endings, RFC 4180
 * quoting, trailing newline. Deterministic — every cell must already be a
 * string (`""` for a blank/missing value, never `"0"`).
 */
export function csvDocument(rows: string[][]): string {
  return BOM + rows.map((row) => row.map(csvField).join(",")).join(EOL) + EOL;
}

/**
 * A filesystem-safe slug: NFKD-folded, ASCII lower-case, every run of
 * non-`[a-z0-9]` characters (spaces, punctuation, combining marks, path
 * separators, `..`, control characters, non-ASCII) collapsed to a single
 * `-`, trimmed, capped at 60 chars. Never empty (`fallback`). No user text
 * can produce an unsafe or traversing filename after this.
 */
export function slugifySegment(value: string, fallback = "file"): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/**
 * `YYYY-MM-DD HH:mm` for an instant, rendered in `timeZone` via
 * `Intl.DateTimeFormat` (IANA tz database, DST-correct) — never manual
 * offset arithmetic.
 */
export function formatWallClockTimestamp(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** The plant-local calendar date (`YYYY-MM-DD`) for an instant. */
export function formatWallClockDate(instant: Date, timeZone: string): string {
  return formatWallClockTimestamp(instant, timeZone).slice(0, 10);
}

/**
 * One cell in a `write-excel-file` sheet. `null` = a genuinely empty cell
 * (never rendered as `0`). Numeric cells carry `type: Number` + a `format`;
 * string cells `type: String`.
 */
export type XlsxCell =
  | null
  | {
      value?: string | number;
      type?: StringConstructor | NumberConstructor;
      format?: string;
      fontWeight?: "bold";
      backgroundColor?: string;
    };

export type XlsxSheet = {
  sheet: string;
  data: XlsxCell[][];
  columns?: Array<{ width: number }>;
  stickyRowsCount?: number;
};

/** Builds a multi-sheet `.xlsx` workbook as a Node `Buffer`. */
export async function writeXlsxWorkbook(sheets: XlsxSheet[]): Promise<Buffer> {
  // `write-excel-file`'s multi-sheet parameter type is stricter than this
  // narrowed cell union; the cell shapes follow its documented contract
  // (`value`/`type`/`format`/`fontWeight`/`backgroundColor`).
  const arg = sheets as unknown as Parameters<typeof writeXlsxFile>[0];
  const buffer = await writeXlsxFile(arg).toBuffer();
  return buffer as Buffer;
}
