"use client";

import { useActionState } from "react";

import {
  changePassword,
  createPassword,
  type ActionResult,
} from "@/app/(platform)/settings/actions";

import { ActionToast } from "./ActionToast";
import { FormField } from "./FormField";
import { SettingsCard } from "./SettingsCard";
import { SubmitButton } from "./SubmitButton";

type SecurityCardProps = {
  isGoogleConnected: boolean;
  hasPassword: boolean;
};

function authenticationLabel(isGoogleConnected: boolean, hasPassword: boolean): string {
  if (isGoogleConnected) {
    return hasPassword ? "Google + Password" : "Google Account";
  }
  return "Password";
}

export function SecurityCard({ isGoogleConnected, hasPassword }: SecurityCardProps) {
  const [createResult, createFormAction, isCreatingPending] = useActionState<
    ActionResult,
    FormData
  >(createPassword, null);
  const [changeResult, changeFormAction, isChangingPending] = useActionState<
    ActionResult,
    FormData
  >(changePassword, null);

  return (
    <SettingsCard title="Security" description="Authentication and password.">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-slate-500">Authentication</p>
          <p className="mt-1 text-sm text-white">
            {authenticationLabel(isGoogleConnected, hasPassword)}
          </p>
        </div>

        <div className="border-t border-white/10 pt-4">
          {!hasPassword ? (
            <>
              <p className="text-xs font-medium text-slate-500">Password</p>
              <p className="mt-1 text-sm text-slate-400">No password configured</p>

              <form action={createFormAction} className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField
                    label="New password"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                  <FormField
                    label="Confirm password"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <SubmitButton
                    isPending={isCreatingPending}
                    label="Create Password"
                    pendingLabel="Creating..."
                  />
                </div>
              </form>
            </>
          ) : (
            <form action={changeFormAction} className="space-y-3">
              <FormField
                label="Current password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="New password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                />
                <FormField
                  label="Confirm password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </div>

              <div className="flex justify-end pt-1">
                <SubmitButton
                  isPending={isChangingPending}
                  label="Change Password"
                  pendingLabel="Changing..."
                />
              </div>
            </form>
          )}
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-white">Two-factor authentication</p>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-500">
              Coming soon
            </span>
          </div>
        </div>
      </div>

      <ActionToast result={createResult ?? changeResult} />
    </SettingsCard>
  );
}
