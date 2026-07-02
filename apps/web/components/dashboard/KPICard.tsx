import Card from "../ui/Card";

type KPICardProps = {
  title: string;
  value: string;
  change?: string;
};

export default function KPICard({
  title,
  value,
  change,
}: KPICardProps) {
  return (
    <Card className="p-4">
      <div className="text-sm text-slate-400">
        {title}
      </div>

      <div className="mt-3 text-3xl font-bold text-white">
        {value}
      </div>

      {change && (
        <div className="mt-2 text-sm text-emerald-400">
          {change}
        </div>
      )}
    </Card>
  );
}