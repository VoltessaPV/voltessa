"use client";

import { usePathname } from "next/navigation";

import { resolvePageHeading } from "./page-headings";

/**
 * The only place the fixed header's eyebrow/title actually render - reads
 * the current route via `usePathname` (a client component is the only way
 * a shared layout's header, which renders before the page it wraps, can
 * know which page it's on) and looks up that page's own declared
 * `pageHeading` (see page-headings.ts).
 */
export function PageHeading() {
  const pathname = usePathname();
  const { eyebrow, title } = resolvePageHeading(pathname);

  return (
    <div>
      <p className="text-xs font-medium text-cyan-400">{eyebrow}</p>
      <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-white">
        {title}
      </h1>
    </div>
  );
}
