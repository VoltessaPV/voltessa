import { LOCALES, flatten, listNamespaces, loadNamespace } from "./lib.mjs";

/**
 * Flags any namespace (other than `terminology.json` itself) whose message
 * VALUE is an exact match for one of the canonical terminology terms — the
 * concrete sign that someone re-authored a term's translation in a second
 * place instead of interpolating `terminology.<term>` (see
 * docs/INTERNATIONALIZATION.md's Translation Guidelines). Exact full-value
 * match only (not substring) — deliberately narrow, so normal prose that
 * happens to contain a term's word inside a longer sentence never
 * false-flags.
 */
let violationCount = 0;

for (const locale of LOCALES) {
  const namespaces = listNamespaces(locale);
  if (!namespaces.includes("terminology")) continue;

  const terminology = loadNamespace(locale, "terminology");
  const termValues = new Set(Object.values(terminology).map((v) => String(v).trim()));

  for (const ns of namespaces) {
    if (ns === "terminology") continue;

    const flat = flatten(loadNamespace(locale, ns));

    for (const [key, value] of Object.entries(flat)) {
      if (typeof value === "string" && termValues.has(value.trim())) {
        console.error(
          `✗ [${locale}] ${ns}.${key} duplicates a canonical term ("${value.trim()}") — interpolate terminology.* instead of re-authoring it.`,
        );
        violationCount++;
      }
    }
  }
}

if (violationCount > 0) {
  console.error(`\n${violationCount} duplicate-terminology violation(s).`);
  process.exit(1);
}

console.log("No duplicate terminology found.");
