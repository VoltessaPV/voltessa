/**
 * This page's own eyebrow/title, declared here (not inline in page.tsx) so
 * it can be safely imported by the client-side heading registry
 * (components/platform/layout/page-headings.ts) without pulling in
 * page.tsx's server-only imports (prisma, auth, ...) into the client
 * bundle. Re-exported from page.tsx so it still reads as "declared on the
 * page" - see AppHeader/PageHeading for where this actually renders.
 */
export const pageHeading = {
  eyebrow: "Live plant operation",
  title: "Dashboard",
} as const;
