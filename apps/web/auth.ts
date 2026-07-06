import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { authConfig } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

const authInstance = NextAuth({
  adapter: PrismaAdapter(prisma),

  session: {
    strategy: "database",
  },

  ...authConfig,
});

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = authInstance;