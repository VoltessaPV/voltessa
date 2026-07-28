export type ToastVariant = "success" | "error";

type ToastProps = {
  message: string;
  variant: ToastVariant;
};

/**
 * Presentational fixed-corner toast, matching the visual convention
 * `components/settings/ActionToast.tsx` already established (same
 * position/color tokens) - used wherever a toast needs to appear outside
 * an `useActionState`-driven form, e.g. after a full-page redirect (see
 * `QueryToast.tsx`).
 */
export function Toast({ message, variant }: ToastProps) {
  return (
    <div
      className={`fixed inset-x-4 bottom-6 z-50 rounded-xl border px-4 py-3 text-sm shadow-[0_12px_28px_-16px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:right-6 sm:max-w-sm ${
        variant === "success"
          ? "border-green-500/20 bg-green-500/10 text-green-300"
          : "border-red-500/20 bg-red-500/10 text-red-300"
      }`}
    >
      {variant === "success" ? "✓" : "✕"} {message}
    </div>
  );
}
