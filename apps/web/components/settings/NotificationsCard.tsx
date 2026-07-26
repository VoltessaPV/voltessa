"use client";

import { useActionState } from "react";

import {
  updateNotificationPreferences,
  type ActionResult,
} from "@/app/(platform)/settings/actions";

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
  const [result, formAction, isPending] = useActionState<ActionResult, FormData>(
    updateNotificationPreferences,
    null,
  );

  return (
    <SettingsCard
      title="Notifications"
      description="Choose which events you want to be notified about."
    >
      <form action={formAction} className="space-y-3">
        <CheckboxField
          label="Automation changes"
          name="automationChanges"
          defaultChecked={props.automationChanges}
        />
        <CheckboxField
          label="Export failures"
          name="exportFailures"
          defaultChecked={props.exportFailures}
        />
        <CheckboxField
          label="Price alerts"
          name="priceAlerts"
          defaultChecked={props.priceAlerts}
        />
        <CheckboxField
          label="Daily summary"
          name="dailySummary"
          defaultChecked={props.dailySummary}
        />
        <CheckboxField
          label="Weekly summary"
          name="weeklySummary"
          defaultChecked={props.weeklySummary}
        />

        <div className="flex justify-end pt-1">
          <SubmitButton isPending={isPending} label="Save" />
        </div>
      </form>

      <ActionToast result={result} />
    </SettingsCard>
  );
}
