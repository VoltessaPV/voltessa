import localFont from "next/font/local";

/**
 * Shared across all three root layouts (`app/[locale]/layout.tsx`,
 * `app/admin/layout.tsx`, `app/dev/layout.tsx`) so the font files are only
 * ever declared once. `next/font/local` only requires the call itself sit
 * at module top level — it doesn't have to be inline in the layout file —
 * so this is a safe, ordinary shared module.
 */
export const geistSans = localFont({
  src: "../app/fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});

export const geistMono = localFont({
  src: "../app/fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});
