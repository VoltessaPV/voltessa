export default function Footer() {
  return (
    <footer className="border-t border-slate-900 bg-[#050816]">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-8 py-10 text-sm text-slate-500 md:flex-row">

        <div>
          © {new Date().getFullYear()} Voltessa. All rights reserved.
        </div>

        <div className="flex items-center gap-6">

          <a
            href="/privacy"
            className="transition hover:text-white"
          >
            Privacy
          </a>

          <a
            href="/terms"
            className="transition hover:text-white"
          >
            Terms
          </a>

          <a
            href="mailto:contact@voltessa.ai"
            className="transition hover:text-white"
          >
            Contact
          </a>

        </div>

      </div>
    </footer>
  );
}