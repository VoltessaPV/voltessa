import ChartCard from "../dashboard/ChartCard";
import BrowserBar from "../dashboard/BrowserBar";
import Sidebar from "../dashboard/Sidebar";
import KPICard from "../dashboard/KPICard";
import AIRecommendationCard from "../dashboard/AIRecommendationCard";
import FleetStatusCard from "../dashboard/FleetStatusCard";
import MarketOverviewCard from "../dashboard/MarketOverviewCard";


export default function DashboardMock() {
  return (
    <div className="w-full max-w-[980px] rounded-3xl border border-slate-800 bg-[#0B1020] shadow-2xl overflow-hidden">

      {/* Browser bar */}
      <BrowserBar />

      <div className="grid grid-cols-[180px_1fr]">

        {/* Sidebar */}
        <Sidebar />

        {/* Content */}

        <main className="p-2">

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">

          <KPICard
            title="PV Power"
            value="272"
            unit="KW"
            change="+2.4%"
          />

          <KPICard
            title="Energy Today"
            value="1743"
            unit="KWh"
            change="+4.1%"
          />

          <KPICard
            title="Battery"
            value="84"
            unit="%"
            change="Healthy"
          />

          <KPICard
            title="Spot Price"
            value="112"
            unit="€/MWh"
            change="+14.8%"
          />

          </div>

          <ChartCard />

          <div className="mt-3 grid grid-cols-12 gap-3">

          <div className="col-span-12 xl:col-span-6">
            <AIRecommendationCard />
          </div>

          <div className="col-span-6 xl:col-span-3">
            <FleetStatusCard />
          </div>

          <div className="col-span-6 xl:col-span-3">
            <MarketOverviewCard />
          </div>

          </div>

        </main>

      </div>

    </div>
  );
}