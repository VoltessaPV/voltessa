/**
 * Named format presets for next-intl's `useFormatter()`/`getFormatter()` —
 * defined once here, referenced by key everywhere, rather than components
 * hand-rolling `Intl.*` calls. Locale governs the formatting *convention*
 * (decimal/thousands separators, calendar display); it never decides *which
 * instant or currency* is being shown — that's data (`Plant.timezone`,
 * `AutomationSettings.currency`), passed in as an override at the call
 * site, never hardcoded here.
 */
export const dateTimeFormats = {
  short: {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  },
  shortWithTime: {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  },
  long: {
    year: "numeric",
    month: "long",
    day: "numeric",
  },
  time: {
    hour: "2-digit",
    minute: "2-digit",
  },
} as const;

export const numberFormats = {
  decimal1: {
    style: "decimal",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  },
  decimal2: {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  },
  percent1: {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  },
  eur: {
    style: "currency",
    currency: "EUR",
  },
} as const;

/**
 * next-intl's `formats` config, passed to the routing/request setup so
 * `useFormatter().dateTime("x", "short")` / `.number("x", "eur")` etc. work
 * with these presets by name everywhere in the app.
 */
export const formats = {
  dateTime: dateTimeFormats,
  number: numberFormats,
};

/**
 * For a currency amount whose currency code is genuinely data-driven
 * (`AutomationSettings.currency`, not always EUR), build an ad hoc
 * `Intl.NumberFormat` options object rather than adding a fixed preset per
 * possible currency code above.
 */
export function currencyFormatOptions(currencyCode: string): Intl.NumberFormatOptions {
  return {
    style: "currency",
    currency: currencyCode,
  };
}

/**
 * A date/time formatted in a specific IANA time zone (`Plant.timezone`),
 * using the given UI locale's conventions — the orthogonality principle
 * from the approved architecture: locale and timezone are independent
 * inputs, never conflated. Use this instead of `useFormatter().dateTime`
 * whenever the value must render in the plant's own timezone rather than
 * the viewer's browser timezone.
 */
export function formatInTimeZone(
  date: Date,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = dateTimeFormats.shortWithTime,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
}
