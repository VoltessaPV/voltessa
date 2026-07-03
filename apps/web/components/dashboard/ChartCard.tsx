import Card from "../ui/Card";
import CardHeader from "./CardHeader";
import ChartTabs from "./ChartTabs";
import LineChart from "./LineChart";

export default function ChartCard() {
  return (
    <Card className="mt-3 p-3">
      <CardHeader
        title="Today's Production"
        subtitle="Live production profile"
        right={<ChartTabs />}
      />

      <LineChart />

      <div className="mt-2 grid grid-cols-3 gap-3 border-t border-slate-800 pt-4">
        <div>
          <div className="text-xs text-slate-400">
            Energy Today
          </div>

          <div className="mt-1 text-xl font-semibold text-white">
            743 КWh
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-400">
            Forecast
          </div>

          <div className="mt-1 text-xl font-semibold text-white">
            932 КWh
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-400">
            Performance
          </div>

          <div className="mt-1 text-lg font-semibold text-emerald-400">
            98.4%
          </div>
        </div>
      </div>
    </Card>
  );
}