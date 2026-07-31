import { LOCALES, SOURCE_LOCALE, extractPlaceholders, flatten, listNamespaces, loadNamespace } from "./lib.mjs";

/**
 * Validates every non-source locale against `messages/en/*` (the source
 * language every translation originates from): every namespace file must
 * be valid JSON (already guaranteed by `require`/`JSON.parse` throwing),
 * every key present in English must exist in every other locale (no
 * missing translations — "no runtime fallback to English for missing keys"
 * is enforced here, not at request time), no locale may have EXTRA keys
 * English doesn't have (English is the source of truth for the key set),
 * and every ICU placeholder (`{name}`) in an English message must appear
 * in the translated message too (catches a translator silently dropping a
 * variable). Run in CI — a failure here fails the build, same as a lint
 * error.
 */
let hasError = false;

function fail(message) {
  hasError = true;
  console.error(`✗ ${message}`);
}

const sourceNamespaces = listNamespaces(SOURCE_LOCALE);

for (const locale of LOCALES) {
  if (locale === SOURCE_LOCALE) continue;

  const localeNamespaces = listNamespaces(locale);

  for (const ns of sourceNamespaces) {
    if (!localeNamespaces.includes(ns)) {
      fail(`[${locale}] missing namespace file: ${ns}.json`);
      continue;
    }

    const sourceFlat = flatten(loadNamespace(SOURCE_LOCALE, ns));
    const targetFlat = flatten(loadNamespace(locale, ns));

    for (const key of Object.keys(sourceFlat)) {
      if (!(key in targetFlat)) {
        fail(`[${locale}] missing key: ${ns}.${key}`);
        continue;
      }

      const sourcePlaceholders = extractPlaceholders(sourceFlat[key]).join(",");
      const targetPlaceholders = extractPlaceholders(targetFlat[key]).join(",");

      if (sourcePlaceholders !== targetPlaceholders) {
        fail(
          `[${locale}] placeholder mismatch in ${ns}.${key}: expected {${sourcePlaceholders}}, got {${targetPlaceholders}}`,
        );
      }
    }

    for (const key of Object.keys(targetFlat)) {
      if (!(key in sourceFlat)) {
        fail(`[${locale}] extra key not present in English (source of truth): ${ns}.${key}`);
      }
    }
  }

  for (const ns of localeNamespaces) {
    if (!sourceNamespaces.includes(ns)) {
      fail(`[${locale}] extra namespace file not present in English: ${ns}.json`);
    }
  }
}

if (hasError) {
  console.error("\ni18n validation failed.");
  process.exit(1);
}

console.log(`i18n validation passed — ${LOCALES.length} locale(s), ${sourceNamespaces.length} namespace(s).`);
