import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { SOURCE_LOCALE, flatten, listNamespaces, loadNamespace } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components", "lib"].map((d) => path.join(APP_ROOT, d));

/**
 * Best-effort "possibly unused key" report — NOT wired into CI (see
 * docs/INTERNATIONALIZATION.md), since accurately tracking which
 * `useTranslations("namespace.sub")` scope a given `t("key")` call belongs
 * to needs real AST analysis, not regex. Heuristic: for each full key path
 * (`dashboard.energyToday.title`), check whether ANY dot-suffix of it
 * (`dashboard.energyToday.title`, `energyToday.title`, `title`) appears as
 * a quoted string literal anywhere in the source tree — if none do, it's
 * flagged as possibly unused. This can't have false negatives from scoping
 * (checking every suffix), but a very short leaf key (e.g. a generic
 * `title`) can produce false positives if it happens to share a name with
 * an unrelated string elsewhere — read the report, don't delete blindly.
 */
function collectSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = SCAN_DIRS.flatMap((dir) => (fs.existsSync(dir) ? collectSourceFiles(dir) : []));
const sourceText = sourceFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

function suffixes(keyPath) {
  const parts = keyPath.split(".");
  return parts.map((_, i) => parts.slice(i).join("."));
}

let possiblyUnused = 0;

for (const ns of listNamespaces(SOURCE_LOCALE)) {
  const flat = flatten(loadNamespace(SOURCE_LOCALE, ns));

  for (const key of Object.keys(flat)) {
    const fullPath = `${ns}.${key}`;
    const candidates = suffixes(fullPath);

    const referenced = candidates.some(
      (candidate) => sourceText.includes(`"${candidate}"`) || sourceText.includes(`'${candidate}'`),
    );

    if (!referenced) {
      console.log(`? possibly unused: ${fullPath}`);
      possiblyUnused++;
    }
  }
}

console.log(`\n${possiblyUnused} possibly-unused key(s) — review before removing (see this script's own doc comment on false positives).`);
