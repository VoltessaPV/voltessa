import { useTranslations } from "next-intl";
import { Fragment } from "react";

/**
 * Landing page product section, below About - a minimal, horizontal
 * step timeline (stacks vertically on small screens). Same section-wrapper
 * convention as SolutionsSection/AboutSection; deliberately no icons/cards
 * here, just dots and connecting lines, per "elegant and minimal, no
 * excessive graphics".
 */
export default function RoadmapSection() {
  const t = useTranslations("marketing.roadmap");
  const steps = t.raw("steps") as string[];

  return (
    <section className="border-t border-slate-900 bg-[#050816] py-24 text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-bold leading-tight">{t("heading")}</h2>
        </div>

        <div className="mx-auto mt-16 flex max-w-4xl flex-col md:flex-row md:items-center">
          {steps.map((step, index) => (
            <Fragment key={step}>
              <div className="flex items-center gap-3 md:flex-col md:gap-0">
                <div className="h-3 w-3 shrink-0 rounded-full bg-blue-500" />
                <span className="text-sm font-medium text-white md:mt-3 md:text-center">
                  {step}
                </span>
              </div>

              {index < steps.length - 1 && (
                <div className="ml-[5px] h-8 w-px bg-slate-800 md:ml-0 md:h-px md:w-full md:flex-1" />
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
