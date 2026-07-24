import { Battery, Layers, Sun, TrendingUp } from "lucide-react";

import { FeatureCard } from "../ui/FeatureCard";

/**
 * Landing page product section, directly below Hero/PlatformPreview -
 * what Voltessa operates today (and, honestly labeled, what's still in
 * development). Same section-wrapper convention as ContactSection
 * (border-t border-slate-900 bg-[#050816] py-24 text-white, max-w-7xl px-8
 * container) and the same shared Card/Badge primitives used everywhere
 * else on this page - no new visual language.
 */
export default function SolutionsSection() {
  return (
    <section id="solutions" className="border-t border-slate-900 bg-[#050816] py-24 text-white">
      <div className="mx-auto max-w-7xl px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-bold leading-tight">Solutions</h2>

          <p className="mt-4 text-lg leading-8 text-slate-400">
            Built for modern renewable energy operations.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-2">
          <FeatureCard
            icon={Sun}
            title="Utility-Scale Solar"
            description="Operate utility-scale photovoltaic plants with real-time monitoring, automated export control and operational visibility."
            highlights={["Live telemetry", "Export control", "Plant analytics", "Operational events"]}
          />

          <FeatureCard
            icon={TrendingUp}
            title="Electricity Markets"
            description="Use day-ahead electricity prices to make better operational decisions and maximize revenue."
            highlights={["ENTSO-E prices", "Revenue insights", "Export recommendations", "Market awareness"]}
          />

          <FeatureCard
            icon={Layers}
            title="Renewable Portfolios"
            description="Manage multiple renewable assets from a single operational platform."
            highlights={["Fleet overview", "Centralized monitoring", "Unified alerts", "Cross-site analytics"]}
          />

          <FeatureCard
            icon={Battery}
            title="Battery Energy Storage"
            description="Battery optimization capabilities currently under development."
            highlights={["State of Charge", "Peak shaving", "Market arbitrage", "Grid services"]}
          />
        </div>
      </div>
    </section>
  );
}
