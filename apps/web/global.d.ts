import type messages from "./messages/en/index";

/**
 * next-intl typed-message augmentation. English is the source language
 * (docs/INTERNATIONALIZATION.md), so its shape is the type contract every
 * `t("namespace.key")` call is checked against — a missing/mistyped key is
 * a compile error, not a silent runtime fallback.
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}
