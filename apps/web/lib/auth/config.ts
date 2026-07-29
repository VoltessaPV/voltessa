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

  callbacks: {
    /**
     * Platform Administration milestone. Blocks a NEW Google sign-in for a
     * deactivated/soft-deleted user BEFORE NextAuth ever creates a Session
     * row - `lib/auth/session.ts`'s findCurrentUserByEmail fix only closes
     * this for an already-active session, not a fresh OAuth handshake.
     * Does its own fresh lookup (same defensive pattern triggerLoginSync
     * already uses below) rather than trusting whatever shape NextAuth
     * hands this callback for a custom Prisma field.
     */
    async signIn({ user }) {
      if (!user.email) {
        return true;
      }

      const record = await prisma.user.findUnique({
        where: { email: user.email },
        select: { deletedAt: true, deactivatedAt: true },
      });

      if (record?.deletedAt || record?.deactivatedAt) {
        return "/login?toast=account-disabled";
      }

      return true;
    },
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
