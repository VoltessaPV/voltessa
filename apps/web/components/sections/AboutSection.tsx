import { Bot, Layers, Sun, TrendingUp, type LucideIcon } from "lucide-react";

import Card from "../ui/Card";

const CAPABILITIES: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: Sun,
    title: "Solar Operations",
    description: "Real-time monitoring and operational awareness.",
  },
  {
    icon: TrendingUp,
    title: "Electricity Markets",
    description: "Integrated market intelligence and revenue optimization.",
  },
  {
    icon: Layers,
    title: "Fleet Management",
    description: "Operate multiple renewable assets from one platform.",
  },
  {
    icon: Bot,
    title: "AI Automation",
    description: "Intelligent workflows designed to reduce manual operations.",
  },
];

/**
 * Landing page product section, below Solutions - the "why" behind the
 * platform. Same section-wrapper/container convention as SolutionsSection
 * and ContactSection; the four capability cards reuse the shared `Card`
 * primitive, just more compact than SolutionsSection's FeatureCard (no
 * highlight list, no badge).
 */
export default function AboutSection() {
  return (
    <section id="about" className="border-t border-slate-900 bg-[#050816] py-24 text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-bold leading-tight">
            Why Voltessa
          </h2>

          <div className="mt-6 space-y-4 text-lg leading-8 text-slate-400">
            <p>
              Renewable energy operations have become significantly more complex. Plant
              monitoring, electricity markets, grid requirements and operational decisions are
              often handled across disconnected systems.
            </p>
            <p>
              Voltessa brings these workflows together into one platform, giving operators a
              clear operational view and the tools to make faster, better-informed decisions.
            </p>
            <p>
              We believe renewable assets should be managed with the same level of operational
              intelligence expected from any modern industrial infrastructure.
            </p>
          </div>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="p-6 transition hover:border-slate-700">
              <div className="inline-flex rounded-xl bg-blue-500/10 p-3 text-blue-400">
                <Icon className="h-5 w-5" />
              </div>

              <h3 className="mt-4 font-semibold text-white">{title}</h3>

              <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
