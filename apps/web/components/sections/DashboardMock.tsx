import ChartCard from "../dashboard/ChartCard";
import BrowserBar from "../dashboard/BrowserBar";
import Sidebar from "../dashboard/Sidebar";
import Card from "../ui/Card";
import KPICard from "../dashboard/KPICard";
import { dashboard } from "../../lib/mock-data";


export default function DashboardMock() {
  return (
    <div className="w-full max-w-[640px] rounded-3xl border border-slate-800 bg-[#0B1020] shadow-2xl overflow-hidden">

      {/* Browser bar */}
      <BrowserBar />

      <div className="grid grid-cols-[180px_1fr]">

        {/* Sidebar */}
        <Sidebar />

        {/* Content */}

        <main className="p-6">

          <div className="grid grid-cols-4 gap-4">

          <KPICard
            title="PV Power"
            value={dashboard.power.value}
            change={dashboard.power.change}
          />

          <KPICard
            title="Today's Yield"
            value={dashboard.yield.value}
            change={dashboard.yield.change}
          />

          <KPICard
            title="Battery SOC"
            value={dashboard.battery.value}
            change={dashboard.battery.change}
          />

          <KPICard
            title="Spot Price"
            value={dashboard.market.value}
            change={dashboard.market.change}
          />

          </div>

          <ChartCard />

          <div className="grid grid-cols-3 gap-4 mt-6">

            {[1,2,3].map((i)=>(
              <Card
                key={i}
                className="h-28"
              />
            ))}

          </div>

        </main>

      </div>

    </div>
  );
}