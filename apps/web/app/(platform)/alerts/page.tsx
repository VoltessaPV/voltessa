import { requireOnboardedUser } from "@/lib/auth/session";

import { AppShell } from "@/components/platform/layout/AppShell";

export default async function AlertsPage() {
  const user = await requireOnboardedUser();

  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      eyebrow="Operational alerts"
      title="Alerts"
    >
      <section>
        <p className="text-white/60">
          Review operational alerts and important platform events.
        </p>
      </section>
    </AppShell>
  );
}
