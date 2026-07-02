import { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
};

export default function CardHeader({
  title,
  subtitle,
  right,
}: Props) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <h3 className="text-sm font-semibold text-white">
          {title}
        </h3>

        {subtitle && (
          <p className="mt-1 text-xs text-slate-500">
            {subtitle}
          </p>
        )}
      </div>

      {right}
    </div>
  );
}