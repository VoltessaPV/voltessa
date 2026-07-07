type AppHeaderProps = {
  user: {
    name: string | null;
    email: string | null;
    role: string;
  };
};

export function AppHeader({
  user,
}: AppHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-white/10 px-6">
      <div>
        <p className="text-sm text-white/50">
          Voltessa Platform
        </p>
      </div>

      <div className="text-right">
        <p className="text-sm font-medium">
          {user.name ?? user.email ?? "User"}
        </p>

        <p className="text-xs text-white/50">
          {user.role}
        </p>
      </div>
    </header>
  );
}