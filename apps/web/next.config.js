/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for next/navigation's forbidden(), used by lib/auth/session.ts
  // to render a 403 instead of a generic thrown error on permission failure.
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
