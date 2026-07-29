"use client";

import { useState, useTransition } from "react";

import { purgeUser } from "@/app/(platform)/admin/actions";

type PurgeUserButtonProps = {
  userId: string;
  email: string;
  eligible: boolean;
  blockers: string[];
};

/**
 * Purge is permanent (unlike Restore, which just clears deletedAt) - same
 * "type the email to confirm" pattern as Settings' DangerZoneCard, not the
 * plainer click-to-confirm used elsewhere in Administration. Only ever
 * rendered on the Deleted Users view (see that page) - eligibility is
 * still re-checked server-side in purgeUser() regardless of what this
 * button shows.
 */
export function PurgeUserButton({ userId, email, eligible, blockers }: PurgeUserButtonProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!eligible) {
    return (
      <div className="text-xs text-white/40">
        <span className="block font-medium text-white/60">Cannot purge</span>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      </div>
    );
  }

  const canPurge = confirmText.trim().toLowerCase() === email.toLowerCase();

  function handlePurge() {
    if (!canPurge || isPending) {
      return;
    }

    startTransition(async () => {
      await purgeUser(userId);
    });
  }

  if (!isConfirming) {
    return (
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500"
      >
        Purge
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-[11px] text-white/50">Type {email} to confirm</span>
        <input
          type="text"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          autoComplete="off"
          className="h-8 w-full rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none transition focus:border-white/20"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canPurge || isPending}
          onClick={handlePurge}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-600"
        >
          {isPending ? "Purging..." : "Confirm Purge"}
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsConfirming(false);
            setConfirmText("");
          }}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
