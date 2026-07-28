type AuthFieldProps = {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
};

/**
 * Labeled input for /login, /create-account, and later auth pages - same
 * visual convention as `components/settings/FormField.tsx` (this codebase's
 * one existing text-input reference), re-declared here rather than imported
 * since these pages sit outside `(platform)` and that component is
 * deliberately scoped to it.
 */
export function AuthField({
  label,
  name,
  type = "text",
  placeholder,
  required,
  autoComplete,
}: AuthFieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-white/80">{label}</span>

      <input
        type={type}
        name={name}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white outline-none transition focus:border-blue-500"
      />
    </label>
  );
}
