import Card from "../ui/Card";

export default function FleetStatusCard() {
  return (
    <Card className="h-full p-2">
      <div className="text-sm font-medium text-slate-400">
        Fleet Status
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="h-3 w-3 rounded-full bg-emerald-400" />

        <span className="text-xl font-semibold text-white">
          All Plants Online
        </span>
      </div>

      <div className="mt-2 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Plants</span>
          <span className="font-medium text-white">2</span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Current Power</span>
          <span className="font-medium text-white">272 KW</span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Availability</span>
          <span className="font-medium text-emerald-400">99.98%</span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Last Update</span>
          <span className="font-medium text-white">12 sec ago</span>
        </div>
      </div>
    </Card>
  );
}