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

  // serverExternalPackages only stops these packages' own JS from being
  // bundled - it does NOT make Next.js's build-time file tracer copy
  // every file the package touches into the deployed function. Both
  // packages read non-JS assets at runtime via paths that aren't
  // statically require()/import()-able, so the tracer misses them
  // entirely: confirmed locally by inspecting
  // .next/server/app/dev/fusionsolar_atlanta/page.js.nft.json, which
  // traced 82 playwright-core files but not browsers.json (needed by
  // lib/coreBundle.js - this is the exact module that threw
  // "Cannot find module '.../playwright-core/browsers.json'" in
  // production), and traced only 8 @sparticuz/chromium files, entirely
  // missing its bin/ directory (chromium.br, the actual browser binary,
  // plus fonts.tar.br/swiftshader.tar.br/al2023.tar.br) - the very next
  // thing chromium.launch() would have needed after browsers.json.
  // Tracing each package's full directory (not just the one file that
  // happened to throw first) avoids trading one missing-file crash for
  // another on the next deploy.
  outputFileTracingIncludes: {
    "/dev/fusionsolar_atlanta": [
      "./node_modules/playwright-core/**",
      "./node_modules/@sparticuz/chromium/**",
    ],
  },
};

export default nextConfig;
