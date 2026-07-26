type CheckboxFieldProps = {
  label: string;
  name: string;
  defaultChecked?: boolean;
  description?: string;
};

/** Labeled checkbox row for Settings > Notifications — same row/border tokens as `FormField`, just a different control. */
export function CheckboxField({
  label,
  name,
  defaultChecked,
  description,
}: CheckboxFieldProps) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-white/5 text-blue-600 focus:ring-0 focus:ring-offset-0"
      />

      <span>
        <span className="block text-sm text-white">{label}</span>
        {description && (
          <span className="block text-xs text-slate-500">{description}</span>
        )}
      </span>
    </label>
  );
}
