export const metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-4xl px-8 py-24 text-slate-200">
      <h1 className="text-4xl font-bold text-white">
        Privacy Policy
      </h1>

      <p className="mt-6 text-slate-400">
        Last updated: July 2026
      </p>

      <div className="mt-12 space-y-10 leading-8 text-slate-300">

        <section>
          <h2 className="text-2xl font-semibold text-white">
            Introduction
          </h2>

          <p className="mt-4">
            Voltessa provides an AI-powered renewable energy management platform
            for photovoltaic plants, battery energy storage systems (BESS) and
            other renewable energy assets.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white">
            Information We Collect
          </h2>

          <p className="mt-4">
            We may collect account information, contact details, operational
            plant data, device telemetry and usage analytics necessary to
            provide our services.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white">
            How We Use Information
          </h2>

          <p className="mt-4">
            Information is used solely for operating the platform, improving
            services, providing analytics, automation and customer support.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white">
            Data Security
          </h2>

          <p className="mt-4">
            Voltessa applies industry best practices to protect customer data,
            authentication credentials and API integrations.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white">
            Contact
          </h2>

          <p className="mt-4">
            Questions regarding this Privacy Policy may be sent to:
            <br />
            <strong>privacy@voltessa.ai</strong>
          </p>
        </section>

      </div>
    </main>
  );
}