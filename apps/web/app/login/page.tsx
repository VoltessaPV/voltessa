import { signIn } from "@/auth";
import { headers } from "next/headers";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B18]">
      <form
        action={async () => {
          "use server";

          // TEMPORARY PKCE diagnostic (Tier 1, point A) — remove after root cause is confirmed.
          const requestHeaders = await headers();
          console.log("[PKCE-DIAG:signin]", {
            resolvedAuthUrl: process.env.AUTH_URL ?? null,
            host: requestHeaders.get("host"),
            xForwardedHost: requestHeaders.get("x-forwarded-host"),
            xForwardedProto: requestHeaders.get("x-forwarded-proto"),
            vercelRegion: process.env.VERCEL_REGION ?? null,
          });

          await signIn("google", {
            redirectTo: "/dashboard",
          });
        }}
      >
        <button
          type="submit"
          className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-500"
        >
          Continue with Google
        </button>
      </form>
    </main>
  );
}