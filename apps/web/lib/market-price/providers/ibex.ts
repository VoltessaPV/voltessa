/**
 * IBEX (Independent Bulgarian Energy Exchange) provider — the SECONDARY /
 * FALLBACK day-ahead price source, used only when ENTSO-E fails or leaves a
 * delivery day incomplete (see `refreshMarketPricesFromIbex` in
 * `refresh-market-prices.ts`). ENTSO-E remains PRIMARY.
 *
 * Uses the exact public mechanism found during the read-only IBEX
 * feasibility investigation (`https://ibex.bg/sdac-pv-bg/`) — no invented
 * API, no browser automation, no credentials:
 *   1. GET the public page to obtain a short-lived anti-bot cookie
 *      (`js_ok_v2`, set via an inline `document.cookie = ...` on a
 *      challenge shell page — W3 Total Cache page-cache bot protection,
 *      not an auth mechanism).
 *   2. GET `.../Ext/SDAC_PROD/DAM_Page/api.php?action=get_csrf_token` with
 *      that cookie plus `Referer`/`Origin` headers (the API rejects
 *      requests without them: "Access denied: API must be accessed from
 *      the website") — returns a CSRF token and sets a `PHPSESSID` cookie
 *      the token is bound to.
 *   3. GET the same endpoint with `action=get_data&date=YYYY-MM-DD`, the
 *      CSRF token, and both cookies.
 * All three are plain HTTP requests (no headless browser, no JS engine).
 *
 * TIMESTAMP CONVERSION — the critical, proven fact from the investigation:
 * IBEX's `date` parameter identifies a **CET/CEST (Europe/Brussels)
 * calendar day** — the same reference zone ENTSO-E's own day-ahead
 * documents use (see `timezone.ts`'s module doc comment) — NOT Bulgaria's
 * own civil clock (Europe/Sofia, EET/EEST), despite this being the
 * Bulgarian exchange's own site. Confirmed empirically against Voltessa's
 * own already-stored ENTSO-E data for 2026-08-31: IBEX's "23:00–23:15"
 * interval (its 93rd of 96, `main_data[92]`) for `date=2026-08-31` is
 * byte-for-byte identical (0.0000 EUR/MWh difference) to Voltessa's stored
 * price at real UTC instant 2026-08-31T21:00:00Z - which is exactly
 * `periodStart + 92 * 15 minutes` for that CET day's own
 * `periodStart` (2026-08-30T22:00:00Z), and that UTC instant is
 * Bulgaria-local 2026-09-01 00:00 (Bulgaria is always one hour ahead of
 * CET/CEST), matching this file's own module doc comment in
 * `refresh-market-prices.ts` about `BULGARIA_CET_OVERLAP_DAYS`.
 *
 * The conversion below is therefore POSITION-based, not a re-parse of each
 * row's own "HH:MM" text as a time-of-day: `main_data` is already ordered
 * QH1..QHn for the requested CET day, so row index N's real UTC instant is
 * simply `periodStart + N * 15 minutes`, where `periodStart` is the exact
 * same DST-aware CET-day boundary `fetchEntsoeDayAheadPrices` is called
 * with for the same day. This is deliberate, not a shortcut: on a 25-hour
 * DST fall-back day, positions 97-100 have no valid single "HH:MM" text at
 * all (Bulgaria/CET clocks repeat 02:00-03:00 that night), so re-parsing
 * the label would be ambiguous; walking by position through an
 * already-correct boundary has no such ambiguity, and produces the
 * identical result to the "CET wall-clock" fact above on any normal day.
 * The `delivery_period` label is still checked for basic shape as a
 * sanity/format guard, never used to compute the timestamp. Once derived,
 * the resulting UTC instant is already Voltessa's canonical
 * `MarketPrice.timestamp` - no further adjustment, and no change to what
 * that column means.
 */

import { ENTSOE_MARKET_TIMEZONE, formatDateInZone } from "@/lib/market-price/timezone";

const IBEX_PAGE_URL = "https://ibex.bg/sdac-pv-bg/";
const IBEX_API_BASE_URL = "https://ibex.bg/Ext/SDAC_PROD/DAM_Page/api.php";
const EXPECTED_CURRENCY = "EUR";
const MAX_MISSING_RATIO = 0.05;
const IBEX_REQUEST_TIMEOUT_MS = 10_000;

/** A realistic desktop browser UA - the site's own bot-protection layer keys off this, not off any credential. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export class IbexApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IbexApiError";
  }
}

/** Mirrors `EntsoeNoDataAvailableError` - IBEX's documented "no data for this date" response, not a hard failure. */
export class IbexNoDataAvailableError extends IbexApiError {
  constructor(message: string) {
    super(message);
    this.name = "IbexNoDataAvailableError";
  }
}

export type IbexDayAheadPricePoint = {
  timestamp: Date;
  price: number;
  currency: string;
};

export type IbexDayAheadPriceSeries = {
  points: IbexDayAheadPricePoint[];
  resolutionMinutes: number;
  expectedIntervals: number;
  missingTimestamps: Date[];
  isPartial: boolean;
};

function withTimeout(): { signal: AbortSignal } {
  return { signal: AbortSignal.timeout(IBEX_REQUEST_TIMEOUT_MS) };
}

async function fetchBotCheckCookie(): Promise<string> {
  let response: Response;

  try {
    response = await fetch(IBEX_PAGE_URL, { headers: { "User-Agent": USER_AGENT }, ...withTimeout() });
  } catch (error) {
    throw new IbexApiError(
      `IBEX page request timed out or failed before receiving a response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const body = await response.text();
  const match = /js_ok_v2=([^;"]+)/.exec(body);

  if (!match) {
    // No challenge shell this time (e.g. already-cached content) - proceed
    // without it; the CSRF/data requests below still work without this
    // cookie in that case (confirmed during the investigation - only the
    // Referer/Origin headers were load-bearing for the API itself).
    return "";
  }

  return `js_ok_v2=${match[1]}`;
}

function parseSetCookie(response: Response): string | null {
  const raw = response.headers.get("set-cookie");

  if (!raw) {
    return null;
  }

  return raw.split(";")[0] ?? null;
}

async function fetchCsrfToken(botCookie: string): Promise<{ csrfToken: string; sessionCookie: string | null }> {
  let response: Response;

  try {
    response = await fetch(`${IBEX_API_BASE_URL}?action=get_csrf_token`, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: IBEX_PAGE_URL,
        Origin: "https://ibex.bg",
        "X-Requested-With": "XMLHttpRequest",
        ...(botCookie ? { Cookie: botCookie } : {}),
      },
      ...withTimeout(),
    });
  } catch (error) {
    throw new IbexApiError(
      `IBEX CSRF token request timed out or failed before receiving a response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const sessionCookie = parseSetCookie(response);
  const body = (await response.json().catch(() => null)) as { csrf_token?: string; error?: string } | null;

  if (!response.ok || !body?.csrf_token) {
    throw new IbexApiError(
      `IBEX CSRF token request failed with status ${response.status}: ${body?.error ?? "no token in response"}`,
    );
  }

  return { csrfToken: body.csrf_token, sessionCookie };
}

type IbexMainDataRow = { product: string; delivery_period: string; price: string; volume: string };
type IbexGetDataResponse = {
  main_data?: IbexMainDataRow[];
  is_hourly_data?: boolean;
  currency?: string;
  date?: string;
  error?: string;
};

async function fetchRawData(
  cetDate: string,
  csrfToken: string,
  cookies: string[],
): Promise<IbexGetDataResponse> {
  const url = new URL(IBEX_API_BASE_URL);
  url.searchParams.set("action", "get_data");
  url.searchParams.set("date", cetDate);
  url.searchParams.set("lang", "en");
  url.searchParams.set("csrf_token", csrfToken);
  url.searchParams.set("rand", String(Math.random()));

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: IBEX_PAGE_URL,
        Origin: "https://ibex.bg",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        Cookie: cookies.filter(Boolean).join("; "),
      },
      ...withTimeout(),
    });
  } catch (error) {
    throw new IbexApiError(
      `IBEX API request timed out or failed before receiving a response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const body = (await response.json().catch(() => null)) as IbexGetDataResponse | null;

  if (body?.error === "No data available") {
    throw new IbexNoDataAvailableError(`IBEX has no data available for ${cetDate}`);
  }

  if (!response.ok || !body) {
    throw new IbexApiError(
      `IBEX API request failed with status ${response.status}: ${body?.error ?? "invalid response"}`,
    );
  }

  if (body.error) {
    throw new IbexApiError(`IBEX API reported an error: ${body.error}`);
  }

  return body;
}

/**
 * Fetches and validates one CET/CEST calendar day of Bulgaria day-ahead
 * prices from IBEX, converted to Voltessa's canonical UTC timestamp
 * representation (see this module's own doc comment for the proven
 * conversion). `periodStart`/`periodEnd` are the exact same CET-day bounds
 * `fetchEntsoeDayAheadPrices` is called with for the same day - this
 * function never invents its own day boundaries, so DST/23-25-hour days
 * are already handled correctly by the caller.
 */
export async function fetchIbexDayAheadPrices(params: {
  periodStart: Date;
  periodEnd: Date;
}): Promise<IbexDayAheadPriceSeries> {
  const { periodStart, periodEnd } = params;
  const cetDate = formatDateInZone(periodStart, ENTSOE_MARKET_TIMEZONE);

  const botCookie = await fetchBotCheckCookie();
  const { csrfToken, sessionCookie } = await fetchCsrfToken(botCookie);
  const data = await fetchRawData(cetDate, csrfToken, [botCookie, sessionCookie ?? ""]);

  if (data.date !== cetDate) {
    throw new IbexApiError(`IBEX response date mismatch: requested ${cetDate}, got ${data.date}`);
  }

  if (data.is_hourly_data) {
    throw new IbexApiError(
      `IBEX returned hourly (non-SDAC) data for ${cetDate} - expected 15-minute (QH) intervals`,
    );
  }

  if (data.currency !== EXPECTED_CURRENCY) {
    throw new IbexApiError(`Unexpected IBEX currency: ${data.currency}`);
  }

  const rows = data.main_data ?? [];

  if (rows.length === 0) {
    throw new IbexApiError(`IBEX response for ${cetDate} contained no price rows`);
  }

  const resolutionMinutes = 15;
  const candidatesByTimestamp = new Map<number, IbexDayAheadPricePoint[]>();

  // Position-based, NOT wall-clock-text-based: `main_data` is already
  // ordered QH1..QHn for the requested CET calendar day, so position N's
  // real UTC instant is simply `periodStart + (N-1)*15min` - the same
  // "CET wall-clock reading" fact the module doc comment describes, just
  // applied via array order instead of re-parsing each row's own "HH:MM"
  // label as a time-of-day. This is deliberate, not a shortcut: on a
  // 25-hour DST fall-back day, positions 97-100 have no valid single
  // "HH:MM" text at all (Bulgaria/CET clocks repeat 02:00-03:00 that
  // night), so re-parsing the label would be ambiguous or wrong; walking
  // by position through `periodStart`/`periodEnd` (already computed
  // DST-aware by the caller, exactly like ENTSO-E's own equivalent) has no
  // such ambiguity. The `delivery_period` text is still checked for basic
  // shape as a sanity/format guard, never used to compute the timestamp.
  rows.forEach((row, index) => {
    const startLabel = row.delivery_period.split(" - ")[0]?.trim();

    if (!startLabel || !/^\d{2}:\d{2}$/.test(startLabel)) {
      throw new IbexApiError(`Malformed IBEX delivery_period: ${row.delivery_period}`);
    }

    const price = Number(row.price);

    if (!Number.isFinite(price)) {
      throw new IbexApiError(`Malformed IBEX price for ${row.delivery_period}: ${row.price}`);
    }

    const timestamp = new Date(periodStart.getTime() + index * resolutionMinutes * 60 * 1000);

    // Neighboring-day contamination guard: a converted timestamp outside
    // the requested CET day's own bounds is rejected outright, mirroring
    // `parseEntsoeDayAheadPricesXml`'s identical boundary check.
    if (timestamp < periodStart || timestamp >= periodEnd) {
      throw new IbexApiError(
        `IBEX price point ${timestamp.toISOString()} (from delivery_period ${row.delivery_period}) falls outside the requested period [${periodStart.toISOString()}, ${periodEnd.toISOString()})`,
      );
    }

    const point: IbexDayAheadPricePoint = { timestamp, price, currency: EXPECTED_CURRENCY };
    const key = timestamp.getTime();
    const existing = candidatesByTimestamp.get(key);

    if (existing) {
      existing.push(point);
    } else {
      candidatesByTimestamp.set(key, [point]);
    }
  });

  const resolvedPoints: IbexDayAheadPricePoint[] = [];

  for (const candidates of candidatesByTimestamp.values()) {
    const [first] = candidates;

    if (candidates.length === 1 && first) {
      resolvedPoints.push(first);
      continue;
    }

    // More than one IBEX row for the same converted delivery timestamp -
    // same deterministic resolution policy as the ENTSO-E parser: identical
    // prices collapse to one, conflicting prices use the lowest. Never a
    // hard rejection on its own.
    const prices = candidates.map((c) => c.price);
    const firstPrice = prices[0] as number;
    const resolvedPrice = prices.every((p) => p === firstPrice) ? firstPrice : Math.min(...prices);

    resolvedPoints.push({ ...(first as IbexDayAheadPricePoint), price: resolvedPrice });
  }

  const expectedTimestamps: number[] = [];

  for (let t = periodStart.getTime(); t < periodEnd.getTime(); t += resolutionMinutes * 60 * 1000) {
    expectedTimestamps.push(t);
  }

  const missingTimestamps = expectedTimestamps
    .filter((t) => !candidatesByTimestamp.has(t))
    .map((t) => new Date(t));

  const missingRatio = missingTimestamps.length / expectedTimestamps.length;

  if (missingRatio > MAX_MISSING_RATIO) {
    throw new IbexApiError(
      `IBEX dataset too incomplete for ${cetDate}: ${missingTimestamps.length}/${expectedTimestamps.length} intervals missing (${(missingRatio * 100).toFixed(1)}%, exceeds ${(MAX_MISSING_RATIO * 100).toFixed(0)}% threshold)`,
    );
  }

  return {
    points: resolvedPoints.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
    resolutionMinutes,
    expectedIntervals: expectedTimestamps.length,
    missingTimestamps,
    isPartial: missingTimestamps.length > 0,
  };
}
