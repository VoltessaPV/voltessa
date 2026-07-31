import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    // Node.js CLI scripts (i18n tooling) - not part of the Next.js app
    // bundle, so they run under Node directly and need its globals
    // (process, console) rather than the browser/React environment the
    // rest of this config assumes.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
];
