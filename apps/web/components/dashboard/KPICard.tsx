import Card from "../ui/Card";

type KPICardProps = {
  title: string;
  value: string;
  unit?: string;
  change?: string;
};

export default function KPICard({
  title,
  value,
  unit,
  change,
}: KPICardProps) {
  return (
    <Card className="h-full p-2">
<div className="text-sm font-medium text-slate-400">
  {title}
</div>

<div className="mt-2 flex items-baseline gap-1">
  <span className="text-[24px] font-bold leading-none text-white">
    {value}
  </span>

  {unit && (
    <span className="text-base text-slate-400">
      {unit}
    </span>
  )}
</div>

{change && (
  <div className="mt-2 text-sm font-medium text-emerald-400">
    {change}
  </div>
)}
    </Card>
  );
}