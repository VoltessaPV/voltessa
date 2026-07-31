import { Bot, Layers, Sun, TrendingUp, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import Card from "../ui/Card";

const CAPABILITY_ICONS: Array<{ key: string; icon: LucideIcon }> = [
  { key: "solarOperations", icon: Sun },
  { key: "electricityMarkets", icon: TrendingUp },
  { key: "fleetManagement", icon: Layers },
  { key: "aiAutomation", icon: Bot },
];

/**
 * Landing page product section, below Solutions - the "why" behind the
 * platform. Same section-wrapper/container convention as SolutionsSection
 * and ContactSection; the four capability cards reuse the shared `Card`
 * primitive, just more compact than SolutionsSection's FeatureCard (no
 * highlight list, no badge).
 */
export default function AboutSection() {
  const t = useTranslations("marketing.about");
  const paragraphs = t.raw("paragraphs") as string[];

  return (
    <section id="about" className="border-t border-slate-900 bg-[#050816] py-24 text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-bold leading-tight">
            {t("heading")}
          </h2>

          <div className="mt-6 space-y-4 text-lg leading-8 text-slate-400">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITY_ICONS.map(({ key, icon: Icon }) => (
            <Card key={key} className="p-6 transition hover:border-slate-700">
              <div className="inline-flex rounded-xl bg-blue-500/10 p-3 text-blue-400">
                <Icon className="h-5 w-5" />
              </div>

              <h3 className="mt-4 font-semibold text-white">{t(`capabilities.${key}.title`)}</h3>

              <p className="mt-2 text-sm leading-6 text-slate-400">{t(`capabilities.${key}.description`)}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
