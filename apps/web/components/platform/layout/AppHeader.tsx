type AppHeaderProps = {
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

export function AppHeader({
  user,
}: AppHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-end border-b border-white/10 px-6">
      <div className="text-left">
        <p className="text-sm font-medium">
          {user.name ?? user.email ?? "User"}
        </p>

        <p className="text-xs text-white/50">
          {displayRole(user.role)}
        </p>
      </div>
    </header>
  );
}