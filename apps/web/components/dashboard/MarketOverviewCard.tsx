import Card from "../ui/Card";

export default function MarketOverviewCard() {
  return (
    <Card className="h-full p-2">
      <div className="text-sm font-medium text-slate-400">
        Market Overview
      </div>

      <div className="mt-2">
        <div className="text-xl font-semibold text-white">
          112
          <span className="ml-1 text-sm font-medium text-slate-400">
            €/MWh
          </span>
        </div>

        <div className="mt-2 text-sm text-emerald-400">
          +14.8% vs yesterday
        </div>
      </div>

      <div className="mt-2 space-y-2 border-t border-slate-800 pt-5">

        <div className="flex justify-between">
          <span className="text-sm text-slate-400">
            Next Negative Price
          </span>

          <span className="text-sm font-medium text-white">
            16:15
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-sm text-slate-400">
            Lowest Price
          </span>

          <span className="text-sm font-medium text-red-400">
            -1.5 €/MWh
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-sm text-slate-400">
            Opportunity
          </span>

          <span className="text-sm font-medium text-emerald-400">
            Medium
          </span>
        </div>

      </div>
    </Card>
  );
}