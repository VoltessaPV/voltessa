"use client";

import { useState, useTransition } from "react";

import { deleteAccount } from "@/app/(platform)/settings/actions";

import { SettingsCard } from "./SettingsCard";

type DangerZoneCardProps = {
  email: string;
};

/**
 * A real, irreversible, production account action — the delete button
 * only becomes clickable after the user types their own email exactly,
 * not a single accidental click. `deleteAccount` signs the browser out on
 * success, so this component never has to handle a "now what" redirect
 * itself.
 */
export function DangerZoneCard({ email }: DangerZoneCardProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();

  const canDelete = confirmText.trim().toLowerCase() === email.toLowerCase();

  function handleDelete() {
    if (!canDelete || isPending) {
      return;
    }

    startTransition(async () => {
      await deleteAccount();
    });
  }

  return (
    <SettingsCard title="Danger Zone" description="Irreversible account actions.">
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
        <p className="text-sm font-medium text-white">Delete account</p>
        <p className="mt-1 text-xs text-slate-400">This action cannot be undone.</p>

        {!isConfirming ? (
          <button
            type="button"
            onClick={() => setIsConfirming(true)}
            className="mt-4 rounded-xl bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            Delete Account
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Type <span className="text-slate-300">{email}</span> to confirm
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoComplete="off"
                className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition focus:border-white/20"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canDelete || isPending}
                onClick={handleDelete}
                className="rounded-xl bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-600"
              >
                {isPending ? "Deleting..." : "Confirm Deletion"}
              </button>

              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setIsConfirming(false);
                  setConfirmText("");
                }}
                className="rounded-xl border border-white/10 px-5 py-2 text-sm font-medium text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
