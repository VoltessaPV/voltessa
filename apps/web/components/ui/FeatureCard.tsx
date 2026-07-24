import { Check, type LucideIcon } from "lucide-react";

import Badge from "./Badge";
import Card from "./Card";

type FeatureCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  highlights: string[];
  badge?: string;
};

/**
 * The landing page's feature-grid card (Solutions section) - built on the
 * same shared `Card` every dashboard card already uses
 * (rounded-2xl/border-slate-800/bg-[#101728]), so a new section reuses the
 * one card primitive the app has instead of inventing a second one.
 */
export function FeatureCard({ icon: Icon, title, description, highlights, badge }: FeatureCardProps) {
  return (
    <Card className="p-8 transition hover:border-slate-700">
      <div className="flex items-start justify-between gap-4">
        <div className="inline-flex rounded-xl bg-blue-500/10 p-3 text-blue-400">
          <Icon className="h-6 w-6" />
        </div>

        {badge && <Badge>{badge}</Badge>}
      </div>

      <h3 className="mt-6 text-xl font-semibold text-white">{title}</h3>

      <p className="mt-3 leading-7 text-slate-400">{description}</p>

      <ul className="mt-6 space-y-2.5">
        {highlights.map((highlight) => (
          <li key={highlight} className="flex items-center gap-2.5 text-sm text-slate-300">
            <Check className="h-4 w-4 shrink-0 text-emerald-400" />
            {highlight}
          </li>
        ))}
      </ul>
    </Card>
  );
}
