"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import {
  updateNotificationPreferences,
  type ActionResult,
} from "@/app/[locale]/(platform)/settings/actions";

import { ActionToast } from "./ActionToast";
import { CheckboxField } from "./CheckboxField";
import { SettingsCard } from "./SettingsCard";
import { SubmitButton } from "./SubmitButton";

type NotificationsCardProps = {
  automationChanges: boolean;
  exportFailures: boolean;
  priceAlerts: boolean;
  dailySummary: boolean;
  weeklySummary: boolean;
};

export function NotificationsCard(props: NotificationsCardProps) {
  const t = useTranslations("settings.notifications");
  const tActions = useTranslations("shared.actions");
  const [result, formAction, isPending] = useActionState<ActionResult, FormData>(
    updateNotificationPreferences,
    null,
  );

  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <form action={formAction} className="space-y-3">
        <CheckboxField
          label={t("automationChanges")}
          name="automationChanges"
          defaultChecked={props.automationChanges}
        />
        <CheckboxField
          label={t("exportFailures")}
          name="exportFailures"
          defaultChecked={props.exportFailures}
        />
        <CheckboxField
          label={t("priceAlerts")}
          name="priceAlerts"
          defaultChecked={props.priceAlerts}
        />
        <CheckboxField
          label={t("dailySummary")}
          name="dailySummary"
          defaultChecked={props.dailySummary}
        />
        <CheckboxField
          label={t("weeklySummary")}
          name="weeklySummary"
          defaultChecked={props.weeklySummary}
        />

        <div className="flex justify-end pt-1">
          <SubmitButton isPending={isPending} label={tActions("save")} />
        </div>
      </form>

      <ActionToast result={result} />
    </SettingsCard>
  );
}
