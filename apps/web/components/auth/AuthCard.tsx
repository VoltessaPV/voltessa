import type { ReactNode } from "react";

type AuthCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

/**
 * The centered card wrapper shared by /login, /create-account, and later
 * auth pages (forgot/reset password, verify email) - same visual language
 * the existing /onboarding page already uses (`bg-[#050816]` full-height
 * background, `w-full max-w-md rounded-2xl border border-white/10
 * bg-white/5 p-8` card), so the new auth pages read as part of the same
 * product rather than a new design.
 */
export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050816] px-6 py-12 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-semibold">{title}</h1>

        {subtitle && <p className="mt-2 text-sm text-white/60">{subtitle}</p>}

        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}
