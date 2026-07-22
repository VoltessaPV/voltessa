import type { NextAuthConfig } from "next-auth";
import { after } from "next/server";
import Google from "next-auth/providers/google";

import { synchronizeFusionSolarConnection } from "@/lib/fusionsolar/telemetry-sync-service";
import { prisma } from "@/lib/prisma";

/**
 * Login-triggered background sync milestone (approved architecture). Fires
 * once per real sign-in — `session: { strategy: "database" }` (see
 * `auth.ts`) means `events.signIn` runs on the actual OAuth exchange, never
 * on an ordinary page navigation or database-session read via `auth()`.
 * Schedules the same, unchanged `synchronizeFusionSolarConnection` (no
 * `force`, same shared `FUSIONSOLAR_SYNC_FRESHNESS_MS` gate the scheduler
 * uses) via `after()`, so the response to the user is never blocked on it.
 * A silent no-op for a user with no organization yet (pre-onboarding) or no
 * FusionSolar connection — mirrors `resolvePlantContext`'s prior behavior
 * exactly, just moved earlier in the request lifecycle.
 */
async function triggerLoginSync(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true },
  });

  if (!user?.organizationId) {
    return;
  }

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: user.organizationId,
        provider: "HuaweiFusionSolar",
      },
    },
    select: { id: true },
  });

  if (!connection) {
    return;
  }

  after(() => {
    synchronizeFusionSolarConnection(connection.id).catch((error: unknown) => {
      console.error(
        "[FusionSolar Telemetry Sync] Login-triggered sync failed unexpectedly",
        { connectionId: connection.id, error },
      );
    });
  });
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

  events: {
    async signIn({ user }) {
      if (!user.id) {
        return;
      }

      await triggerLoginSync(user.id);
    },
  },
} satisfies NextAuthConfig;
