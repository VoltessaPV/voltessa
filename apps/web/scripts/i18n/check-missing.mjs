import { LOCALES, SOURCE_LOCALE, flatten, listNamespaces, loadNamespace } from "./lib.mjs";

/**
 * Focused missing-key report (a subset of `validate.mjs`, which also checks
 * placeholder consistency and extra keys) — run this during development
 * for a quick "what's left to translate" list per locale/namespace.
 */
let missingCount = 0;

for (const locale of LOCALES) {
  if (locale === SOURCE_LOCALE) continue;

  for (const ns of listNamespaces(SOURCE_LOCALE)) {
    const sourceFlat = flatten(loadNamespace(SOURCE_LOCALE, ns));
    const targetFlat = flatten(loadNamespace(locale, ns));

    const missing = Object.keys(sourceFlat).filter((key) => !(key in targetFlat));

    if (missing.length > 0) {
      console.log(`\n[${locale}] ${ns}.json — ${missing.length} missing key(s):`);
      for (const key of missing) {
        console.log(`  - ${key}`);
      }
      missingCount += missing.length;
    }
  }
}

if (missingCount > 0) {
  console.error(`\n${missingCount} missing translation(s) total.`);
  process.exit(1);
}

console.log("No missing translations.");
