import Image from "next/image";
import Button from "../ui/Button";

export default function Navbar() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-8">

        {/* Logo */}

        <div className="flex items-center gap-3">
          <Image
            src="/logo/voltessa-mark.png"
            alt="Voltessa"
            width={60}
            height={60}
            priority
          />

          <span className="text-2xl font-semibold tracking-tight text-white">
            Voltessa
          </span>
        </div>

        {/* Navigation */}

        <nav className="hidden items-center gap-10 text-sm text-slate-300 md:flex">
          <a href="#" className="transition hover:text-white">
            Platform
          </a>

          <a href="#" className="transition hover:text-white">
            Solutions
          </a>

          <a href="#" className="transition hover:text-white">
            About
          </a>

          <a href="#" className="transition hover:text-white">
            Contact
          </a>
        </nav>

        {/* CTA */}

        <Button className="px-6 py-3 text-sm">
          Request Demo
        </Button>

      </div>
    </header>
  );
}