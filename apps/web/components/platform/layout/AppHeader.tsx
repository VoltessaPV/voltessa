type AppHeaderProps = {
  /** The page's own eyebrow/title metadata - each page declares these, AppHeader is the only place that renders them (Fixed Header Architecture milestone). */
  eyebrow: string;
  title: string;
  user: {
    name: string | null;
    email: string | null;
    role: string;
  };
};

/** Display-only formatting - `user.role` itself stays the raw Role enum value used for permission checks everywhere else. */
function displayRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function AppHeader({ eyebrow, title, user }: AppHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-white/10 px-6">
      <div>
        <p className="text-xs font-medium text-cyan-400">{eyebrow}</p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-white">
          {title}
        </h1>
      </div>

      <div className="text-left">
        <p className="text-sm font-medium">
          {user.name ?? user.email ?? "User"}
        </p>

        <p className="text-xs text-white/50">{displayRole(user.role)}</p>
      </div>
    </header>
  );
}
