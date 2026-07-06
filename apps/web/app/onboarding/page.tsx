import { createOrganization } from "./actions";

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B18]">
      <form
        action={createOrganization}
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-10"
      >
        <h1 className="text-3xl font-bold text-white">
          Welcome to Voltessa
        </h1>

        <p className="mt-3 text-gray-400">
          Create your organization.
        </p>

        <input
          name="name"
          placeholder="Company name"
          className="mt-8 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white"
        />

        <button
          className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-500"
        >
          Continue
        </button>
      </form>
    </main>
  );
}