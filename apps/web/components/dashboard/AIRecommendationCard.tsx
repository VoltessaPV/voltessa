import Card from "../ui/Card";
import Button from "../ui/Button";

export default function AIRecommendationCard() {
  return (
    <Card className="p-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-400">
            AI Recommendation
          </div>

          <div className="text-xl font-semibold text-white">
            Charge Battery Fleet A
          </div>
        </div>

        <div className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-400">
          97%
        </div>
      </div>

      <div className="mt-2 text-sm leading-6 text-slate-300">
        Negative electricity prices are expected in
        <span className="font-semibold text-white"> 52 minutes</span>.
        Charging the battery at 16:15 is projected to increase today's revenue.
      </div>

      <div className="mt-2 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Expected Gain
          </div>

          <div className="mt-1 text-2xl font-bold text-emerald-400">
            54.2 €
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Confidence
          </div>

          <div className="mt-1 text-2xl font-bold text-white">
            97%
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Button className="w-full">
          Review Recommendation
        </Button>
      </div>
    </Card>
  );
}