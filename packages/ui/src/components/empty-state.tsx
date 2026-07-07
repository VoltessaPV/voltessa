interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-10 text-center">
      <h3 className="text-xl font-semibold text-white">
        {title}
      </h3>

      <p className="mt-2 text-zinc-400">
        {description}
      </p>

      {action && (
        <div className="mt-6">
          {action}
        </div>
      )}
    </div>
  );
}