# Sprint 1

## Завършено

- [x] Market Service
- [x] Decision Service
- [x] Plant Service
- [x] Automation Service
- [x] Mock Driver

## Предстои

- [ ] FusionSolar Client
- [ ] Login
- [ ] Read Export Mode
- [ ] Stop Export
- [ ] Resume Export
- [ ] Scheduler
- [ ] Event Log

---

# Sprint 1A — Security & Authorization Foundation

## Completed

- Centralized current-user / organization / role lookup into `lib/auth/session.ts`
  (`getCurrentUser`, `requireCurrentUser`, `requireOnboardedUser`, `requirePermission`), replacing
  the duplicated `auth()` + Prisma-lookup pattern across seven `(platform)` pages/actions
- Enforced the existing `Permissions.can*` RBAC model (previously defined but unused) on the plant
  read and write surfaces (`canViewPlants`, `canManagePlants`)
- Represented authorization failure with Next.js's own `forbidden()`, alongside the existing
  `redirect()` (auth/onboarding) and `notFound()` (missing plant) conventions
- See ADR-006 in `docs/ARCHITECT_DECISIONS.md` for the full decision record

---

# Sprint 1B — Authorization Follow-through

## Planned

- Extend the shared session/authorization pattern to the FusionSolar route handlers
  (`app/api/auth/fusionsolar/*`, `app/api/diag/*`), which still duplicate the pre-Sprint-1A pattern
  because `next/navigation`'s `redirect()`/`forbidden()` don't work in Route Handlers
- Give the `forbidden()` (403) state a custom `forbidden.tsx` instead of relying on Next's default
  fallback
- Decide whether `settings/page.tsx` needs a `Permissions` bucket (none of the existing four map
  cleanly to "manage integrations" today)
- Retire the unused `domains/auth/types.ts` `SessionUser` type now that `CurrentUser` in
  `lib/auth/session.ts` supersedes it
- Fix the pre-existing `packages/ui` lint/type-check breakage (`../lib/utils` import, empty-interface
  warnings) so `pnpm lint` / `turbo check-types` can pass repo-wide again

---

# Sprint 2

- PostgreSQL
- Prisma
- React Dashboard
- Authentication

---

# Sprint 3

- Multi Plant
- KACO
- SMA
- Notifications