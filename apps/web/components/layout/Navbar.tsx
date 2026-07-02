export default function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-8">

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">
            ⚡
          </div>

          <span className="text-xl font-semibold text-white">
            Voltessa
          </span>
        </div>

        <nav className="hidden gap-10 text-slate-300 md:flex">
          <a href="#">Platform</a>
          <a href="#">Solutions</a>
          <a href="#">About</a>
          <a href="#">Contact</a>
        </nav>

        <button className="rounded-xl bg-blue-600 px-5 py-3 text-white transition hover:bg-blue-500">
          Talk to Us
        </button>

      </div>
    </header>
  );
}