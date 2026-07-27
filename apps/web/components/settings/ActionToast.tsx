"use client";

import { useEffect, useState } from "react";

import type { ActionResult } from "@/app/(platform)/settings/actions";

/**
 * Same fixed-position toast shape `HuaweiControlCard` already established
 * (`components/ui`/`packages/ui` aren't used anywhere in `(platform)` — see
 * that component's own doc comment) — reused here via a shared component
 * instead of six copies, one per Settings card, since every card's
 * server-action result renders identically.
 *
 * Auto-dismisses 4s after `result` last changed - `useActionState`'s own
 * state has no "clear" affordance, so this wraps it in local visibility
 * state that resets on every new result.
 */
export function ActionToast({ result }: { result: ActionResult }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!result) {
      return;
    }

    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [result]);

  if (!result || !visible) {
    return null;
  }

  return (
    <div
      className={`fixed inset-x-4 bottom-6 z-50 rounded-xl border px-4 py-3 text-sm shadow-[0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:right-6 sm:max-w-sm ${
        result.success
          ? "border-green-500/20 bg-green-500/10 text-green-300"
          : "border-red-500/20 bg-red-500/10 text-red-300"
      }`}
    >
      {result.success ? "✓" : "✕"} {result.message}
    </div>
  );
}
