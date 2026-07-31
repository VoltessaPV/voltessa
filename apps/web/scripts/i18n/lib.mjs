import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MESSAGES_ROOT = path.resolve(__dirname, "../../messages");
export const LOCALES = fs
  .readdirSync(MESSAGES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

export const SOURCE_LOCALE = "en";

export function listNamespaces(locale) {
  return fs
    .readdirSync(path.join(MESSAGES_ROOT, locale))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function loadNamespace(locale, namespace) {
  const file = path.join(MESSAGES_ROOT, locale, `${namespace}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Flattens a nested message object into dot-path -> value pairs (arrays kept as a single leaf value, not expanded). */
export function flatten(obj, prefix = "") {
  const out = {};

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path));
    } else {
      out[path] = value;
    }
  }

  return out;
}

/** Every ICU `{placeholder}` name found in a string value. */
export function extractPlaceholders(value) {
  if (typeof value !== "string") return [];
  const matches = value.match(/\{([a-zA-Z0-9_]+)/g) ?? [];
  return matches.map((m) => m.slice(1)).sort();
}
