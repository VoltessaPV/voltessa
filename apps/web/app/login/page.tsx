import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B18]">
      <form
        action={async () => {
          "use server";

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