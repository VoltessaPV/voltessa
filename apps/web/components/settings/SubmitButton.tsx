type SubmitButtonProps = {
  isPending: boolean;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "danger";
};

/** Same primary-button tokens as the existing FusionSolar Connect/Add Plant buttons on this page (`bg-blue-600 ... hover:bg-blue-500`), plus a danger variant for the Danger Zone. */
export function SubmitButton({
  isPending,
  label,
  pendingLabel,
  variant = "primary",
}: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={isPending}
      className={`rounded-xl px-5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
        variant === "danger"
          ? "bg-red-600 hover:bg-red-500 disabled:hover:bg-red-600"
          : "bg-blue-600 hover:bg-blue-500 disabled:hover:bg-blue-600"
      }`}
    >
      {isPending ? (pendingLabel ?? "Saving...") : label}
    </button>
  );
}
