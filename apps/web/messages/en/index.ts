import terminology from "./terminology.json";
import shared from "./shared.json";
import navigation from "./navigation.json";
import marketing from "./marketing.json";
import auth from "./auth.json";
import onboarding from "./onboarding.json";
import dashboard from "./dashboard.json";
import settings from "./settings.json";
import market from "./market.json";
import clients from "./clients.json";
import alerts from "./alerts.json";
import automations from "./automations.json";
import battery from "./battery.json";
import legal from "./legal.json";
import cookieConsent from "./cookie-consent.json";
import emails from "./emails.json";
import validation from "./validation.json";
import errors from "./errors.json";
import charts from "./charts.json";
import tables from "./tables.json";
import forms from "./forms.json";
import dialogs from "./dialogs.json";
import notifications from "./notifications.json";

/**
 * The complete English message tree — the source of truth every other
 * locale's structure is validated against (see scripts/i18n/validate.mjs).
 * One namespace per top-level key; components scope to one via
 * `useTranslations("<namespace>")`. English is the source language every
 * translation originates from (docs/INTERNATIONALIZATION.md).
 */
const messages = {
  terminology,
  shared,
  navigation,
  marketing,
  auth,
  onboarding,
  dashboard,
  settings,
  market,
  clients,
  alerts,
  automations,
  battery,
  legal,
  "cookie-consent": cookieConsent,
  emails,
  validation,
  errors,
  charts,
  tables,
  forms,
  dialogs,
  notifications,
} as const;

export default messages;
