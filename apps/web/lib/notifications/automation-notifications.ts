import { createTranslator } from "next-intl";

import { translateDecisionReason } from "@/lib/automation/automation-event-i18n";
import enMessages from "@/messages/en/index";

import { ntfyNotificationProvider } from "./providers/ntfy";
import type { Notification, NotificationProvider } from "./provider";

const ATLANTA_PLANT_NAME = "Atlanta";

/**
 * Full Internationalization milestone: ntfy notifications go to a single
 * shared topic per plant (`lib/notifications/providers/ntfy.ts`), not a
 * specific user — there is no one "recipient locale" to render in, unlike
 * email (`User.locale`). Deliberately, explicitly English, using next-intl's
 * `createTranslator` (the non-request-scoped API, exactly for usage outside
 * the React tree) purely so the decision-reason CODE
 * (`lib/automation/export-decision.ts`'s `ExportDecisionReasonCode` —
 * `AutomationEvent.reason` now stores a code, not prose) renders as a real
 * sentence here instead of the raw code string.
 */
const englishTranslator = createTranslator({ locale: "en", messages: enMessages });
const tDecisionReasons = (key: string, values?: Record<string, string>) =>
  englishTranslator(`automations.eventLog.decisionReasons.${key}` as never, values as never);
const tTerminology = (key: string) => englishTranslator(`terminology.${key}` as never);

/**
 * Every currently-active provider. A future Email/WhatsApp/SMS provider is
 * added here, alongside ntfy - nothing else in this file, or any caller,
 * needs to change.
 */
const ACTIVE_PROVIDERS: NotificationProvider[] = [ntfyNotificationProvider];

/**
 * Exactly the AutomationEvent `type` values that ever produce a
 * notification (Notification Provider milestone) - a plain string union,
 * not imported from lib/automation/automation-events.ts, so this module
 * has zero dependency on the automation domain's own types. "mode_changed"
 * only reaches here after the Automation Service call succeeded AND
 * AutomationState was updated AND the AutomationEvent row itself
 * committed - see createAutomationEvent, the only caller of
 * sendAutomationNotification.
 */
export type AutomationNotificationEventType =
  | "mode_changed"
  | "automation_service_failed"
  | "reconciliation_failed"
  | "reconciliation_restored";

export type AutomationNotificationInput = {
  type: string;
  previousMode: string | null;
  newMode: string | null;
  currentPrice: number | null;
  threshold: number | null;
  reason: string;
  errorMessage: string | null;
  createdAt: Date;
};

function formatEuroPerMwh(value: number): string {
  return `€${value.toFixed(2)} / MWh`;
}

function formatSofiaTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} Europe/Sofia`;
}

function buildNotification(input: AutomationNotificationInput): Notification | null {
  const time = formatSofiaTimestamp(input.createdAt);
  const price = input.currentPrice !== null ? formatEuroPerMwh(input.currentPrice) : "—";
  const threshold = input.threshold !== null ? formatEuroPerMwh(input.threshold) : "—";
  const modeTransition = `${input.previousMode ?? "Unknown"} → ${input.newMode ?? "Unknown"}`;

  switch (input.type as AutomationNotificationEventType) {
    case "mode_changed":
      return {
        title: "Voltessa",
        priority: "default",
        tags: ["green_circle", "electric_plug"],
        body: [
          `🟢 ${ATLANTA_PLANT_NAME}`,
          "",
          "Export mode changed",
          "",
          modeTransition,
          "",
          "Current price",
          price,
          "",
          "Threshold",
          threshold,
          "",
          "Reason",
          translateDecisionReason(tDecisionReasons, tTerminology, input.reason),
          "",
          "Time",
          time,
        ].join("\n"),
      };

    case "automation_service_failed":
      return {
        title: "Voltessa",
        priority: "high",
        tags: ["warning", "electric_plug"],
        body: [
          `🔴 ${ATLANTA_PLANT_NAME}`,
          "",
          "Export mode change FAILED",
          "",
          "Attempted",
          modeTransition,
          "",
          "Current price",
          price,
          "",
          "Threshold",
          threshold,
          "",
          "Reason",
          input.reason,
          "",
          "Error",
          input.errorMessage ?? "Unknown error",
          "",
          "Time",
          time,
        ].join("\n"),
      };

    case "reconciliation_failed":
      return {
        title: "Voltessa",
        priority: "high",
        tags: ["warning", "lock"],
        body: [
          `🔴 ${ATLANTA_PLANT_NAME}`,
          "",
          "Daily FusionSolar reconciliation FAILED",
          "",
          "Voltessa could not determine the current export mode.",
          "",
          "Reason",
          input.reason,
          "",
          "Time",
          time,
          "",
          "Action recommended",
          "Please verify FusionSolar credentials and connectivity.",
        ].join("\n"),
      };

    case "reconciliation_restored":
      return {
        title: "Voltessa",
        priority: "default",
        tags: ["green_circle", "unlock"],
        body: [
          `🟢 ${ATLANTA_PLANT_NAME}`,
          "",
          "Daily FusionSolar reconciliation restored",
          "",
          "FusionSolar access has been restored.",
          "",
          "Time",
          time,
        ].join("\n"),
      };

    default:
      // Every other AutomationEvent type (reconciliation_mismatch,
      // reconciliation_synced, or any future type) never sends a
      // notification - "Nothing else sends notifications."
      return null;
  }
}

/**
 * The only place lib/automation ever reaches into the notification system
 * (via createAutomationEvent, after its AutomationEvent row has committed -
 * never called directly by the scheduler/reconciliation modules
 * themselves). Notification delivery must never fail automation
 * execution: every provider send is individually wrapped in try/catch, and
 * this function itself never throws.
 */
export async function sendAutomationNotification(
  input: AutomationNotificationInput,
): Promise<void> {
  const notification = buildNotification(input);

  if (!notification) {
    return;
  }

  for (const provider of ACTIVE_PROVIDERS) {
    try {
      await provider.send(notification);
    } catch (error) {
      console.error("[Notifications] Failed to send", {
        provider: provider.name,
        type: input.type,
        error,
      });
    }
  }
}
