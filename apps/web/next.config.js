import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for next/navigation's forbidden(), used by lib/auth/session.ts
  // to render a 403 instead of a generic thrown error on permission failure.
  experimental: {
    authInterrupts: true,
  },
  // Multi-Horizon Self-Learning Forecast milestone: onnxruntime-node's native
  // binary (libonnxruntime.so.1 + onnxruntime_binding.node) is loaded via a
  // dynamic native require Next's build-time file tracer can't statically
  // discover, so it's silently dropped from the deployed function bundle
  // without this - confirmed in production via a real "libonnxruntime.so.1:
  // cannot open shared object file" runtime error before this was added.
  outputFileTracingIncludes: {
    "/api/internal/forecast/ml-refresh": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**"],
  },
};

export default withNextIntl(nextConfig);
