# Coding Standards

Concrete conventions derived from the actual code in this repo, plus `docs/CONVENTIONS.md`. Where
the codebase is currently inconsistent, that's called out explicitly — follow the recommended
direction for new code rather than copying the inconsistency.

## TypeScript (all workspaces)

- `packages/typescript-config/base.json` sets `strict: true` and, notably,
  `noUncheckedIndexedAccess: true` — array/object index access returns `T | undefined`; handle the
  `undefined` case instead of asserting it away (see `NETWORK_RETRY_DELAYS_MS[attempt - 1]` in
  `apps/web/lib/fusionsolar/get-valid-access-token.ts` being checked for `undefined` before use).
- Use `import type { X } from ...` for type-only imports (`docs/CONVENTIONS.md`); this is enforced
  by convention, not currently by an eslint rule, so don't skip it just because lint passes without
  it.
- Prefer explicit `type`/`interface` definitions for API and gateway response shapes (see
  `FusionSolarTokenResponse`, `FusionSolarApiResponse<T>`) over `any` — `apps/api`'s eslint config
  turns `@typescript-eslint/no-explicit-any` off, but new code shouldn't rely on that.
- Custom error classes extend `Error`, set `this.name` explicitly, and carry structured context as
  readonly fields (see `FusionSolarApiError` with `httpStatus`/`failCode`/`response`,
  `apps/web/lib/errors.ts`'s `AppError`). Prefer this over throwing bare strings or unstructured
  errors when the caller might need to branch on the failure.
- `apps/web/lib/result.ts` defines a `Result<T>` discriminated union (`{ success: true; data } |
  { success: false; error }`). It exists but is not consistently used yet — most `lib/fusionsolar/*`
  functions throw instead. When writing new code that can fail in an *expected, caller-handled* way
  (e.g. "no connection configured yet"), prefer `Result<T>`; reserve thrown errors for unexpected
  failures a route handler will catch and turn into a 500.
- Logging: `apps/web/lib/logger.ts` provides `logger.info/warn/error`. Existing FusionSolar code
  mostly calls `console.error`/`console.log` directly with a `"[Context Name]"` prefix string (e.g.
  `"[FusionSolar Gateway Token Request] Fetch failed"`). Prefer `logger.*` with the same bracketed
  context-prefix style for new code so log calls are easy to intercept/replace later.

## Formatting

- `apps/api` has its own `.prettierrc` (`singleQuote: true`, `trailingComma: "all"`).
- There is no root or `apps/web`-level `.prettierrc`, so Prettier defaults apply there (double
  quotes, semicolons). Match whichever workspace's existing style surrounds the code you're
  editing.
- Run `pnpm format` (root `prettier --write "**/*.{ts,tsx,md}"`) before committing. Some existing
  files (e.g. `apps/api/src/plant/plant.service.ts`) have inconsistent indentation from not having
  been run through Prettier after manual edits — don't propagate that; format files you touch.

## Prisma conventions (`apps/web/prisma/schema.prisma`)

- **Multi-tenancy is mandatory** (`docs/VISION.md`): every tenant-scoped model has an
  `organizationId String` field with a `@relation` to `Organization`, and `onDelete: Cascade` where
  the child is meaningless without the parent (see `Device`, `PlantTelemetrySnapshot`,
  `FusionSolarConnection`). Never add a model that stores tenant data without this.
- IDs are `String @id @default(cuid())` throughout — keep using `cuid()`, not `uuid()` or
  autoincrement ints.
- Natural per-tenant uniqueness is modeled as a composite `@@unique`, e.g.
  `@@unique([organizationId, stationCode])` on `Plant`, `@@unique([plantId, devDn])` on `Device`.
  Follow this pattern (`@@unique([organizationId, <natural-key>])`) instead of relying on a global
  unique constraint on the natural key alone — the same `stationCode` could legitimately exist
  across two organizations in theory.
- Money and measurement values are `Decimal` with explicit precision, e.g.
  `@db.Decimal(18, 4)` for energy/income figures, `@db.Decimal(10, 2)` for capacity,
  `@db.Decimal(9, 6)` for lat/lng. Never use `Float` for these. Convert incoming
  string/number values with a small `toDecimal()`-style guarded helper (see
  `apps/web/lib/fusionsolar/sync-plants.ts`) rather than calling `new Prisma.Decimal()` directly
  against untrusted input.
- Bulk upserts from external data (FusionSolar sync) use `prisma.$transaction([...])` with
  `prisma.<model>.upsert()` per record, keyed on the composite unique constraint — see
  `syncFusionSolarPlants`. Follow this pattern for any new "sync external vendor data into our DB"
  function.
- Import the shared client from `@/lib/prisma` (the singleton in `apps/web/lib/prisma/client.ts`,
  which reuses a `globalThis`-cached instance outside production to survive HMR). Never
  `new PrismaClient()` elsewhere.
- Schema changes: the repo currently mixes `prisma db push` (most schema evolution) with one
  committed migration. State explicitly which one you're using for a given change — see
  `docs/AI_PLAYBOOK.md`.

## Next.js conventions (`apps/web`)

- App Router with route groups: `app/(marketing)` is the public site, `app/(platform)` is the
  authenticated app. Put new public marketing pages under `(marketing)`, new logged-in
  dashboard/operator screens under `(platform)`.
- **Server Components by default.** Nothing in the codebase currently uses `"use client"` — every
  component is a Server Component. Only add `"use client"` when you need actual browser
  interactivity (state, effects, event handlers); don't add it defensively.
- Server Actions use the `"use server"` directive at the top of the file, take a `FormData`
  argument for form submissions, then `redirect(...)` to the next screen on success. For anything
  under `app/(platform)/*`, get the current user via `lib/auth/session.ts` (see below) rather than
  calling `auth()` and looking the user up by hand. `app/onboarding/actions.ts` is the one
  deliberate exception — it runs before an organization exists, so `requireOnboardedUser()`'s
  guarantee doesn't apply there, and it still calls `auth()` directly.
- Auth: NextAuth v5 (`auth.ts` at the app root), `PrismaAdapter`, **database session strategy**
  (not JWT) — session lookups hit Postgres, so don't assume session reads are free.
  `lib/auth/session.ts` is the single source of truth for "who is signed in, what organization are
  they in, what's their role" (see ADR-006 in `docs/ARCHITECT_DECISIONS.md`) — use
  `requireCurrentUser()` (redirects to `/login`), `requireOnboardedUser()` (also redirects to
  `/onboarding` if the organization isn't set up), or `requirePermission(allowedRoles)` (also calls
  `forbidden()` if the role doesn't match) instead of calling `auth()` and
  `prisma.user.findUnique` directly. `proxy.ts` (the NextAuth middleware, matcher
  `/dashboard/:path*`) only gates "is logged in" for that one path prefix — the `session.ts`
  helpers are what actually enforce onboarding and role/permission on every `(platform)` page and
  action today. Extend `lib/auth/permissions.ts`'s `Permissions.can*` buckets (keyed by
  `lib/auth/roles.ts`'s `Roles.ADMIN/OWNER/OPERATOR/VIEWER`) rather than hardcoding a role check
  inline.
- Route handlers under `app/api/**` follow a consistent shape for external/internal integration
  endpoints (see `app/api/internal/fusionsolar/ingest-plant-telemetry/route.ts`): explicit
  `export const runtime = "nodejs"`, `preferredRegion`, and `dynamic = "force-dynamic"` where the
  route must not be cached or edge-executed; a small `isAuthorized()`/`secretsMatch()` guard using
  `crypto.timingSafeEqual` for bearer-token-protected internal endpoints (never `===` on secrets);
  and a `NextResponse.json({ ok, ...details }, { status })` response shape on both success and
  error paths.
- `lib/env.ts` centralizes a couple of public runtime env values (`appName`, `appUrl`) with
  fallback defaults. Add new *public, non-secret* runtime config there rather than calling
  `process.env.NEXT_PUBLIC_*` inline in components.
- `lib/routes.ts` centralizes route path constants (`routes.dashboard`, `routes.login`, ...). Use
  it instead of hardcoding path strings when linking between top-level routes; extend it as new
  top-level routes are added (it currently doesn't cover every `(platform)` route — that's a gap,
  not a signal to hardcode paths going forward).

## NestJS conventions (`apps/api`)

Per `docs/ARCHITECTURE.md` / `docs/CONVENTIONS.md` / ADR-001:

- **Controllers** contain only HTTP logic (route + status codes), delegating everything else to a
  **Service**.
- **Services** contain business logic and depend on other services/interfaces via constructor
  injection, never on concrete implementations directly (`AutomationService` depends on the
  `PlantDriver` interface via the `PLANT_DRIVER` injection token in
  `apps/api/src/drivers/constants.ts`, not on `HuaweiDriver`/`MockDriver` directly — see
  `apps/api/src/app.module.ts` for how the concrete class is bound).
- **Drivers** communicate with hardware/vendor systems (e.g. a future `HuaweiDriver`). **Clients**
  communicate with external APIs (e.g. `FusionSolarClient`). A Driver may use a Client; a Service
  should depend on a Driver interface, not a Client directly, when the operation is
  vendor/hardware-specific.
- New vendor support is added by implementing the `PlantDriver` interface
  (`apps/api/src/drivers/plant-driver.interface.ts`) and binding it via DI in the relevant module —
  never by branching on vendor type inside `AutomationService`.
- Module wiring stays centralized in `app.module.ts`; don't register a controller/provider anywhere
  else.
- Follow the existing `*.controller.ts` / `*.service.ts` / `*.types.ts` file-per-concern naming
  inside each feature folder (`automation/`, `decision/`, `market/`, `plant/`, `drivers/`,
  `fusionsolar/`).

## General

- File naming: kebab-case for non-component TypeScript files (`get-valid-access-token.ts`,
  `sync-plant-telemetry.ts`), PascalCase for React component files (`KPICard.tsx`,
  `FleetStatusCard.tsx`), camelCase for functions and variables, `SCREAMING_SNAKE_CASE` for
  module-level constants (`TOKEN_EXPIRY_BUFFER_MS`, `NETWORK_RETRY_DELAYS_MS`).
- English is the development language throughout code, including comments and commit messages,
  even though some product docs are currently in Bulgarian (`docs/VISION.md`, "Engineering
  Principles").
- Don't add abstraction beyond what the current architecture already scaffolds (see "Scope
  discipline" in `docs/AI_PLAYBOOK.md`).
