import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// TEMPORARY PKCE diagnostic (Tier 1, point B) — remove after root cause is confirmed.
// Redacts any field that could carry a secret/cookie/PKCE value; only exposes
// cookie names, TTLs, and presence/length metadata.
const PKCE_DIAG_SENSITIVE_KEYS = new Set(["payload", "cookie", "value", "state"]);

function pkceDiagRedact(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return metadata;
  const safe: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(metadata as Record<string, unknown>)) {
    if (PKCE_DIAG_SENSITIVE_KEYS.has(key)) {
      safe[key] = {
        redacted: true,
        present: val != null,
        length: typeof val === "string" ? val.length : undefined,
      };
    } else {
      safe[key] = val;
    }
  }
  return safe;
}

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],

  pages: {
    signIn: "/login",
  },

  // TEMPORARY PKCE diagnostic (Tier 1, point B) — remove after root cause is confirmed.
  debug: true,
  logger: {
    debug(message, metadata) {
      if (!message.includes("PKCECODEVERIFIER") && !message.includes("STATE")) return;
      console.log("[PKCE-DIAG:core-debug]", message, pkceDiagRedact(metadata));
    },
    error(error) {
      const cause = error.cause as { name?: string; message?: string } | undefined;
      console.error("[PKCE-DIAG:core-error]", {
        name: (error as { type?: string }).type ?? error.name,
        message: error.message,
        causeName: cause?.name ?? null,
        causeMessage: cause?.message ?? null,
      });
    },
  },
} satisfies NextAuthConfig;