import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for next/navigation's forbidden(), used by lib/auth/session.ts
  // to render a 403 instead of a generic thrown error on permission failure.
  experimental: {
    authInterrupts: true,
  },
  // Multi-Horizon Self-Learning Forecast milestone: onnxruntime-node has a
  // native binary (libonnxruntime.so.1 + onnxruntime_binding.node) it loads
  // via a dynamic require, and its own internal loader resolves that binary's
  // path relative to its own unbundled __dirname. Turbopack bundling this
  // package rewrites that path resolution and breaks it even once the raw
  // files are present - serverExternalPackages keeps it a plain external
  // require() instead. outputFileTracingIncludes alone (added first) was
  // NOT sufficient by itself - confirmed in production: the "libonnxruntime.so.1:
  // cannot open shared object file" error persisted even after the trace fix
  // deployed, until this was added too.
  serverExternalPackages: ["onnxruntime-node"],
  outputFileTracingIncludes: {
    "/api/internal/forecast/ml-refresh": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**"],
  },
};

export default withNextIntl(nextConfig);
