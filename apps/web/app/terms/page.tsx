export const metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-4xl px-8 py-24 text-slate-200">
      <h1 className="text-4xl font-bold text-white">
        Terms of Service
      </h1>

      <p className="mt-6 text-slate-400">
        Last updated: July 2026
      </p>

      <div className="mt-12 space-y-10 leading-8 text-slate-300">

        <section>
          <h2 className="text-2xl font-semibold text-white">
            Acceptance
          </h2>

          <p className="mt-4">
            By using Voltessa you agree to these Terms of Service.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white">
            Services
          </h2>

          <p className="mt-4">
            Voltessa provides monitoring, analytics, automation and remote
            management services for renewable energy assets.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white">
            User Responsibilities
          </h2>

          <p className="mt-4">
            Users are responsible for maintaining account security and ensuring
            that connected assets are authorized for management.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white">
            Limitation of Liability
          </h2>

          <p className="mt-4">
            Voltessa is provided on an &quot;as available&quot; basis. Users remain
            responsible for operational decisions affecting their energy assets.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white">
            Contact
          </h2>

          <p className="mt-4">
            legal@voltessa.ai
          </p>
        </section>

      </div>
    </main>
  );
}