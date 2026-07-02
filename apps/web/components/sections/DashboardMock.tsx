import BrowserBar from "../dashboard/BrowserBar";
import Card from "../ui/Card";

export default function DashboardMock() {
  return (
    <div className="w-full max-w-[640px] rounded-3xl border border-slate-800 bg-[#0B1020] shadow-2xl overflow-hidden">

      {/* Browser bar */}
      <BrowserBar />

      <div className="grid grid-cols-[180px_1fr]">

        {/* Sidebar */}

        <aside className="border-r border-slate-800 p-6">

          <div className="text-white font-semibold mb-8">
            Voltessa
          </div>

          <div className="space-y-4 text-slate-400 text-sm">

            <div className="text-blue-400">
              Overview
            </div>

            <div>Plants</div>

            <div>BESS</div>

            <div>Market</div>

            <div>Automation</div>

            <div>Reports</div>

          </div>

        </aside>

        {/* Content */}

        <main className="p-6">

          <div className="grid grid-cols-4 gap-4">

            {[1,2,3,4].map((i)=>(
              <Card
                key={i}
                className="h-24"
              />
            ))}

          </div>

          <Card className="mt-6 h-64" />

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