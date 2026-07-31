"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { usePathname, useRouter } from "@/lib/i18n/navigation";

import { Toast, type ToastVariant } from "./Toast";

const TOAST_MESSAGES: Record<string, { message: string; variant: ToastVariant }> = {
  "password-reset": {
    message: "Password reset. Please log in with your new password.",
    variant: "success",
  },
  "account-disabled": {
    message: "This account is no longer active. Contact your administrator.",
    variant: "error",
  },
};

/**
 * Reads a `?toast=<key>` query param set by a server-side redirect
 * (password reset landing on /login - see app/reset-password/actions.ts),
 * shows the matching message for a few seconds, then strips the param
 * from the URL so a refresh or a shared link never re-shows it. Mount
 * once per page that can be a redirect target for one of these keys -
 * see app/login/page.tsx. Not itself platform- or auth-specific; a
 * future redirect-with-toast anywhere else just adds a key to the map
 * above and mounts this wherever it lands.
 */
export function QueryToast() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const key = searchParams.get("toast");
  const entry = key ? TOAST_MESSAGES[key] : undefined;

  const [visible, setVisible] = useState(Boolean(entry));

  useEffect(() => {
    if (!entry) {
      return;
    }

    setVisible(true);

    const timer = setTimeout(() => {
      setVisible(false);

      const params = new URLSearchParams(searchParams);
      params.delete("toast");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 5000);

    return () => clearTimeout(timer);
  }, [entry, pathname, router, searchParams]);

  if (!entry || !visible) {
    return null;
  }

  return <Toast message={entry.message} variant={entry.variant} />;
}
