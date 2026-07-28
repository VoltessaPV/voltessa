import { PageHeading } from "./PageHeading";
import { UserMenu } from "./UserMenu";

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

export function AppHeader({ user }: AppHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between gap-3 border-b border-white/10 pl-16 pr-4 lg:px-6">
      <div className="min-w-0 flex-1">
        <PageHeading />
      </div>

      <UserMenu name={user.name ?? user.email ?? "User"} role={displayRole(user.role)} />
    </header>
  );
}
