import { ReactNode } from "react";

type AppShellProps = {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
};

export default function AppShell({
  sidebar,
  header,
  children,
}: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-[#050816] text-white">

      <aside className="w-64 border-r border-slate-800">
        {sidebar}
      </aside>

      <div className="flex flex-1 flex-col">

        <header className="h-16 border-b border-slate-800">
          {header}
        </header>

        <main className="flex-1 p-8">
          {children}
        </main>

      </div>

    </div>
  );
}