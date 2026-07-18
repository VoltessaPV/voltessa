import type { NextRequest } from "next/server";
import { handlers } from "@/auth";

// TEMPORARY PKCE diagnostic (Tier 1, point C) — remove after root cause is confirmed.
// Logs request metadata only, then delegates unchanged to the real handler.
function logPkceDiagCallback(req: NextRequest) {
  console.log("[PKCE-DIAG:callback]", {
    url: req.url,
    protocol: req.nextUrl.protocol,
    host: req.headers.get("host"),
    xForwardedHost: req.headers.get("x-forwarded-host"),
    xForwardedProto: req.headers.get("x-forwarded-proto"),
    resolvedAuthUrl: process.env.AUTH_URL ?? null,
    vercelRegion: process.env.VERCEL_REGION ?? null,
  });
}

export async function GET(req: NextRequest) {
  logPkceDiagCallback(req);
  return handlers.GET(req);
}

export async function POST(req: NextRequest) {
  logPkceDiagCallback(req);
  return handlers.POST(req);
}