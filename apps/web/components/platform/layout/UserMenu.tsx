"use client";

import { ChevronDown, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { signOutAction } from "@/lib/auth/actions";

type UserMenuProps = {
  name: string;
  role: string;
};

/**
 * The header's top-right user menu - was a static name/role block, now an
 * interactive dropdown (Settings, Sign out). `shrink-0` on the outer
 * container preserves the Responsive Design Sprint's discipline: a long
 * name/role can never force the header wider than the viewport, same as
 * before this component existed.
 */
export function UserMenu({ name, role }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative min-w-0 shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex min-w-0 items-center gap-2 rounded-lg py-1 pl-2 pr-1 text-left transition hover:bg-white/5"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-white/50">{role}</p>
        </div>

        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/50 transition ${isOpen ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#0B1020] shadow-[0_12px_28px_-16px_rgba(0,0,0,0.55)]"
        >
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-white/80 transition hover:bg-white/5 hover:text-white"
          >
            <Settings className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            Settings
          </Link>

          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-white/80 transition hover:bg-white/5 hover:text-white"
            >
              <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
