"use client";

import { usePathname } from "next/navigation";

/**
 * Single source of truth for every platform page's eyebrow/title, keyed by
 * route - this is what lets AppHeader render the heading exactly once
 * (Fixed Header Architecture milestone) without AppShell needing to be
 * rendered per-page: a shared layout has no way to receive a prop from the
 * page it wraps, but a client component can read the current route itself
 * via `usePathname`, so the lookup happens here instead.
 */
const STATIC_HEADINGS: Record<string, { eyebrow: string; title: string }> = {
  "/dashboard": { eyebrow: "Live plant operation", title: "Dashboard" },
  "/market": { eyebrow: "Bulgarian day-ahead market", title: "Market" },
  "/automations": {
    eyebrow: "Automated export control",
    title: "Automations",
  },
  "/alerts": { eyebrow: "Operational alerts", title: "Alerts" },
  "/settings": { eyebrow: "System configuration", title: "Settings" },
  "/plants": { eyebrow: "Power Plants", title: "Plants" },
  "/plants/new": { eyebrow: "Power Plants", title: "Add Plant" },
};

function resolveHeading(pathname: string): { eyebrow: string; title: string } {
  const staticMatch = STATIC_HEADINGS[pathname];
  if (staticMatch) {
    return staticMatch;
  }

  // /plants/[id] and /plants/[id]/edit - the only dynamic-segment routes
  // under (platform); everything else above is a static path.
  if (/^\/plants\/[^/]+\/edit$/.test(pathname)) {
    return { eyebrow: "Power Plants", title: "Edit Plant" };
  }
  if (/^\/plants\/[^/]+$/.test(pathname)) {
    return { eyebrow: "Power Plants", title: "Plant Details" };
  }

  return { eyebrow: "", title: "" };
}

export function PageHeading() {
  const pathname = usePathname();
  const { eyebrow, title } = resolveHeading(pathname);

  return (
    <div>
      <p className="text-xs font-medium text-cyan-400">{eyebrow}</p>
      <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-white">
        {title}
      </h1>
    </div>
  );
}
