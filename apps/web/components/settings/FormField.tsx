type FormFieldProps = {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  autoComplete?: string;
};

/**
 * Labeled text input — the input styling matches `MarketToolbar`'s native
 * date input (`rounded-lg border border-white/10 bg-white/5 ... text-white`),
 * the only existing text-input reference in `(platform)`, just sized for a
 * full-width settings form instead of a toolbar.
 */
export function FormField({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
  readOnly,
  required,
  autoComplete,
}: FormFieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-500">
        {label}
      </span>

      <input
        type={type}
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        autoComplete={autoComplete}
        className={`h-9 w-full rounded-lg border border-white/10 px-3 text-sm text-white outline-none transition focus:border-white/20 ${
          readOnly
            ? "cursor-not-allowed bg-white/[0.02] text-slate-400"
            : "bg-white/5"
        }`}
      />
    </label>
  );
}
