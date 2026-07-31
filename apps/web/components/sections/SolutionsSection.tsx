import { Battery, Layers, Sun, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("marketing.solutions");

  return (
    <section id="solutions" className="border-t border-slate-900 bg-[#050816] py-24 text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-bold leading-tight">{t("heading")}</h2>

          <p className="mt-4 text-lg leading-8 text-slate-400">
            {t("subheading")}
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-2">
          <FeatureCard
            icon={Sun}
            title={t("utilityScaleSolar.title")}
            description={t("utilityScaleSolar.description")}
            highlights={t.raw("utilityScaleSolar.highlights") as string[]}
          />

          <FeatureCard
            icon={TrendingUp}
            title={t("electricityMarkets.title")}
            description={t("electricityMarkets.description")}
            highlights={t.raw("electricityMarkets.highlights") as string[]}
          />

          <FeatureCard
            icon={Layers}
            title={t("renewablePortfolios.title")}
            description={t("renewablePortfolios.description")}
            highlights={t.raw("renewablePortfolios.highlights") as string[]}
          />

          <FeatureCard
            icon={Battery}
            title={t("batteryEnergyStorage.title")}
            description={t("batteryEnergyStorage.description")}
            highlights={t.raw("batteryEnergyStorage.highlights") as string[]}
          />
        </div>
      </div>
    </section>
  );
}
