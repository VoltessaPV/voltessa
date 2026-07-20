import { requireOnboardedUser } from "@/lib/auth/session";

import { AppShell } from "@/components/platform/layout/AppShell";

export default async function AutomationsPage() {
  const user = await requireOnboardedUser();

  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      eyebrow="Automated export control"
      title="Automations"
    >
      <section>
        <p className="text-white/60">
          Configure plant control strategies and automation rules.
        </p>
      </section>
    </AppShell>
  );
}
