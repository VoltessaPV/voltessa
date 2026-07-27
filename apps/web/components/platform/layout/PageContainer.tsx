import type { ReactNode } from "react";

type PageContainerProps = {
  children: ReactNode;
  /** Extra classes merged in after the container's own — typically vertical rhythm (`space-y-3`, `space-y-5`), which varies per page. */
  className?: string;
};

/**
 * The one wrapper every full-width platform page (Dashboard, Market,
 * Settings, Automations) and the landing page's PlatformPreview mockup
 * render through — `mr-auto max-w-7xl`, previously duplicated verbatim in
 * each file. Extracted per the Responsive Design Sprint's "no page-specific
 * CSS hacks, extract reusable primitives" requirement, so a future change
 * to the shared page-width strategy has exactly one place to land.
 *
 * Already responsive by construction — `max-w-7xl` is a cap, not a fixed
 * width, so this container fills 100% of its (already-responsive, see
 * `AppShell`) parent on any viewport narrower than 1280px. Nothing here
 * needs a breakpoint override of its own.
 */
export function PageContainer({ children, className = "" }: PageContainerProps) {
  return (
    <div className={["mr-auto max-w-7xl", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
