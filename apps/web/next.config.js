/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for next/navigation's forbidden(), used by lib/auth/session.ts
  // to render a 403 instead of a generic thrown error on permission failure.
  experimental: {
    authInterrupts: true,
  },

  // These carry native/binary payloads (a Chromium build, in two forms)
  // that must not be processed by Next.js's own bundler - used only by
  // lib/fusionsolar/browser/browser.ts (app/dev/fusionsolar_atlanta).
  serverExternalPackages: ["playwright", "playwright-core", "@sparticuz/chromium"],
};

export default nextConfig;
