# Architecture Decisions

A log of architecture decisions for Voltessa, in English, with a reusable template. This
complements — it does not replace — `docs/DECISIONS/ADR-001-automation-driver.md`, which is the
original (Bulgarian) ADR from the project's bootstrap. That numbering continues here: **new ADRs
go in this file, starting at ADR-002.** `docs/DECISIONS/` stays as the historical record of
ADR-001; don't renumber or move it.

Per `docs/CONVENTIONS.md`, architectural decisions are recorded as ADRs — meaning a new
abstraction, a new cross-cutting pattern, or a vendor/library choice, not routine feature work.
See `docs/AI_PLAYBOOK.md` and `CLAUDE.md`'s "Never silently change architecture" rule: when a task
introduces a decision like the ones below, add an entry here before considering the task done.

## ADR Template

Copy this block for a new decision:

```markdown
## ADR-00X: <short, decision-focused title>

### Status

Proposed | Accepted | Superseded by ADR-00Y

### Context

What situation or problem made a decision necessary? What constraints applied (multi-tenancy,
vendor-neutrality, "Human Always in Control", MVP scope from docs/CLIENT_REQUIREMENTS.md, etc.)?

### Decision

What was decided, stated as a concrete, checkable rule — not a vague direction.

### Consequences

What this makes easier, what it makes harder, and what it rules out. Include follow-up work this
creates, if any.
```

---

## ADR-001: Automation Service depends on PlantDriver, not on Huawei

See `docs/DECISIONS/ADR-001-automation-driver.md` (original, Bulgarian). Summary: `AutomationService`
depends on the `PlantDriver` interface; the concrete driver (`HuaweiDriver`, `MockDriver`, future
`KacoDriver`, etc.) is selected via dependency injection (`PLANT_DRIVER` token in
`apps/api/src/drivers/constants.ts`, bound in `apps/api/src/app.module.ts`). Adding a new vendor
does not require changing `AutomationService`. This is the concrete implementation of the
"Multi-vendor by Design" principle in `docs/VISION.md` — see `docs/PROJECT_CONTEXT.md`.

## ADR-002: Multi-tenancy is a first-class relation, not an afterthought

### Status

Accepted (in effect since the initial Prisma schema — `6081028 feat(auth): add prisma foundation
and core models`)

### Context

`docs/VISION.md` states multi-tenancy is mandatory from day one, because Voltessa is built to scale
from one plant to thousands across many owners/operators. Retrofitting tenant isolation onto a
schema built without it is expensive and risky (easy to leak data across tenants).

### Decision

Every tenant-scoped Prisma model carries an explicit `organizationId String` field with a
`@relation` to `Organization`, and natural-key uniqueness is scoped per tenant via composite
`@@unique([organizationId, <natural-key>])` constraints (e.g. `Plant.@@unique([organizationId,
stationCode])`, `Device.@@unique([plantId, devDn])` scoped transitively through `Plant`). See
`docs/CODING_STANDARDS.md` for the full pattern. `User.organizationId` is nullable to support the
pre-onboarding state (a signed-in user with no organization yet — see
`app/onboarding/actions.ts`), but every operational model (`Plant`, `Device`,
`FusionSolarConnection`, `PlantTelemetrySnapshot`) requires it.

### Consequences

New models must be designed with `organizationId` from the start; a model that stores tenant data
without it is a bug, not a style choice. This does make onboarding (a user existing before an
organization does) slightly more complex, handled explicitly in `app/onboarding/actions.ts` rather
than by relaxing the constraint elsewhere.

## ADR-003: NextAuth v5 with Prisma adapter and database session strategy

### Status

Accepted (`7add4b1 feat(auth): implement Google authentication and organization onboarding`,
`8a4e811 feat(auth): implement Google OAuth authentication`). The "Server Actions call `auth()`
directly" detail below was refined by ADR-006: `app/(platform)/*` pages/actions now go through
`lib/auth/session.ts` instead. `app/onboarding/actions.ts` and the FusionSolar route handlers still
call `auth()` directly, for the reasons noted in ADR-006.

### Context

Voltessa needed real user authentication (Google OAuth) tied to the same Postgres database as the
rest of the domain data, with sessions that can be inspected/revoked server-side (relevant for a
platform that will hold RBAC state and, eventually, operator actions with real consequences).

### Decision

Authentication uses NextAuth v5 (`auth.ts`) with `@auth/prisma-adapter`'s `PrismaAdapter(prisma)`
and `session: { strategy: "database" }` — not JWT sessions. Google is the only configured provider
today (`lib/auth/config.ts`). Route-level protection for the authenticated app is centralized in
`proxy.ts` (NextAuth middleware, matcher `/dashboard/:path*`); Server Actions and route handlers
that need auth call `auth()` directly rather than re-deriving session state another way. (See
ADR-006 for how `app/(platform)/*` call sites now do this in practice.)

### Consequences

Every session check is a database read, not a stateless JWT verify — acceptable at current scale,
but a future scaling concern worth revisiting explicitly (not silently switching to JWT) if session
lookups become a bottleneck. Because sessions live in Postgres, revoking a session (e.g. removing a
compromised user) is a direct, reliable database operation.

## ADR-004: FusionSolar API access goes through a dedicated gateway service

### Status

Accepted (`557032d route FusionSolar stations through generic gateway API`, `baa385f route
FusionSolar devices through generic gateway API`, `0445ff8 route FusionSolar token refresh through
gateway`)

### Context

Early FusionSolar integration attempts called the FusionSolar API directly from Vercel serverless
functions and required extensive debugging of OAuth/network behavior (see the long
`debug(fusionsolar): log OAuth authorization URL` sequence in git history). The integration ended
up needing a stable, allow-listable egress point and centralized secret handling in front of
Huawei's API.

### Decision

`apps/web` never calls the FusionSolar API directly. All calls (`OAuth token exchange/refresh`,
station/device/telemetry reads) go through a gateway service reached via `FUSIONSOLAR_GATEWAY_URL`,
authenticated with `FUSIONSOLAR_GATEWAY_SECRET` (see `lib/fusionsolar/api-client.ts`,
`get-valid-access-token.ts`). Vercel functions that talk to FusionSolar (directly or via the
gateway) are pinned to the `fra1` region (`apps/web/vercel.json`).

### Consequences

Any new FusionSolar-related capability must go through `callFusionSolarApi`/the gateway pattern,
not a direct `fetch` to Huawei's API. This is also why `FUSIONSOLAR_GATEWAY_URL` and
`FUSIONSOLAR_GATEWAY_SECRET` must stay populated for the integration to work at all — they're not
optional/dev-only despite currently being missing from `turbo.json`'s `globalEnv` (see "Known gaps"
in `CLAUDE.md`).

## ADR-005: `apps/api` stays an isolated architecture prototype

### Status

Accepted (implicit — no commit has ever wired `apps/web` to call `apps/api`, and `apps/api` has no
deployment configuration)

### Context

`apps/api` (NestJS) was built first, as the clean reference implementation of the
Controller/Service/Driver/Client + `PlantDriver` DI architecture (ADR-001). Once real feature work
started, it moved faster to build directly in `apps/web` (Next.js route handlers/Server Actions
against Prisma) rather than standing up a second deployed service and an HTTP boundary between
them.

### Decision

`apps/api` remains in the repo as the reference implementation of the automation architecture
pattern and is not called by `apps/web`. It is not deployed. Real automation/decision logic for the
live product is implemented directly in `apps/web` today. Wiring the two together (or
re-implementing `apps/web`'s automation logic against the `apps/api` pattern with a `PlantDriver`
abstraction) is a deliberate future decision, not something to do incidentally while working on an
unrelated task.

### Consequences

There are, deliberately, two places that "look like" automation domain code. An agent or engineer
new to the repo can mistake `apps/api` for the live backend — `CLAUDE.md` and
`docs/AI_PLAYBOOK.md` call this out explicitly to prevent that. If/when `apps/web`'s FusionSolar
integration grows a second vendor, revisit whether it's time to introduce a `PlantDriver`-style
abstraction in `apps/web` itself (superseding part of this ADR) rather than reaching for `apps/api`.

## ADR-006: Centralized Session & Authorization Layer

### Status

Accepted (Sprint 1A, commit `a1a6119 refactor(auth): centralize session and authorization`)

### Context — why the change was introduced

An architecture report on multi-tenancy (pre-Sprint-1A) found that every `(platform)` page and
Server Action independently called `auth()`, then ran its own `prisma.user.findUnique({ where:
{ email: session.user.email } })` to get the user's `organizationId` (and sometimes `role`,
`organization.name`), then hand-rolled its own `redirect("/login")` / `redirect("/onboarding")`
guards. The same six-to-ten-line block was duplicated across seven files. Separately, the RBAC
model already defined in `lib/auth/permissions.ts` (`Permissions.canViewPlants` /
`canManagePlants` / `canOperatePlants` / `canManagePlatform`) was never imported anywhere — any
authenticated member of an organization, regardless of role, could create or edit that
organization's plants.

### Previous architecture

- No shared accessor: `auth()` → manual Prisma lookup → manual redirect, copy-pasted per file,
  with the exact set of selected fields (and thus the exact behavior) drifting slightly from file
  to file.
- No enforcement layer: `Permissions.can*` existed as data but was never consulted before a
  mutation.
- No consistent way to represent "not allowed" — nothing in the codebase distinguished
  "unauthenticated," "authenticated but no organization yet," and "authenticated, has an
  organization, but the wrong role" as separate, intentional states.

### Decision — new architecture

`apps/web/lib/auth/session.ts` is now the single source of truth for "who is the current user,
what organization are they in, what's their role, and are they allowed to do this," exposed as
four functions of increasing strictness, each building on the previous one:

- `getCurrentUser()` — `auth()` + one Prisma lookup, returns `CurrentUser | null`, no redirect.
- `requireCurrentUser()` — same, `redirect("/login")` if unauthenticated.
- `requireOnboardedUser()` — also `redirect("/onboarding")` if the user has no organization or
  that organization hasn't completed onboarding; returns a type where `organizationId`/
  `organization` are non-null.
- `requirePermission(allowedRoles)` — also calls `forbidden()` if `user.role` isn't in
  `allowedRoles`.

Every function fetches the same consistent shape (`id`, `name`, `email`, `role`, `organizationId`,
`organization`) in one `select`, instead of each call site picking different fields. The seven
duplicated call sites (`app/(platform)/layout.tsx`, `dashboard/page.tsx`, `plants/page.tsx`,
`plants/[id]/page.tsx`, `plants/[id]/edit/page.tsx`, `plants/actions.ts`, `settings/page.tsx`) were
rewritten to call the appropriate one of these four functions. `Permissions.canViewPlants` now
gates the plant read pages and `Permissions.canManagePlants` now gates `createPlant`/`updatePlant`
and the edit page — the concrete enforcement gap the architecture report identified.
`app/onboarding/actions.ts` deliberately still does its own `auth()` check: it runs *before* an
organization exists, so `requireOnboardedUser()`'s guarantee doesn't apply there, and the
FusionSolar route handlers (`app/api/auth/fusionsolar/*`, `app/api/diag/*`) also still do their own
check, for the reason in the next section.

### Why `redirect()`, `notFound()`, and `forbidden()` are used

All three are Next.js App Router's own purpose-built control-flow primitives, not generic thrown
errors: each throws an `Error` carrying a specific `digest` string
(`NEXT_REDIRECT;...` / `NEXT_HTTP_ERROR_FALLBACK;404` / `NEXT_HTTP_ERROR_FALLBACK;403`) that the
framework's own rendering pipeline recognizes and handles specially — including surviving the
Server-Component-to-client serialization boundary intact, unlike a generic thrown error's message,
which Next.js redacts in production builds. `redirect()` was already the established pattern for
"not logged in" / "no organization yet" before Sprint 1A (ADR-003); `notFound()` was already used
for a missing plant record (`plants/[id]/page.tsx`). `forbidden()` is the natural third state —
"authenticated, onboarded, but the wrong role" — and using it keeps all three "the user can't
proceed as requested" outcomes on one consistent, framework-native mechanism instead of introducing
a bespoke error class and a custom error boundary for just the permission case. `forbidden()`
requires `experimental.authInterrupts: true` in `next.config.js` (without it, `forbidden()` itself
throws a configuration error) — this is the one new configuration surface Sprint 1A added, and
nothing else. No custom `forbidden.tsx` was added; Next's built-in 403 fallback is used, the same
way this app already relies on Next's built-in 404 fallback for `notFound()` without a custom
`not-found.tsx`.

### Benefits

- One place defines "current user," so its shape and guarantees can change (or be tested) once
  instead of in seven places.
- The `Permissions` RBAC model, previously dead code, is now actually enforced at the one write
  path that needed it.
- Net reduction in code: the refactor removed more lines than it added (`session.ts` is ~110 lines;
  it replaced ~170 lines of duplicated logic across seven files).
- Permission-denied, missing-resource, and not-authenticated all render correctly and consistently
  via Next's own fallback system, in both dev and production — no risk of a permission failure
  leaking a raw stack trace or generic 500 in production the way a plain thrown error would.
- Adding a new `Permissions`-gated screen or action going forward is a one-line
  `requirePermission(Permissions.someBucket)` call, not a new copy of the six-to-ten-line guard
  block.

### Consequences

- **Intentional behavior change for non-`OWNER` roles.** `createPlant`/`updatePlant` now reject
  `VIEWER`/`OPERATOR`, which was previously (unintentionally) allowed. In current data every user's
  role is `OWNER` (the only role `app/onboarding/actions.ts` ever assigns), so this is unlikely to
  affect anyone today, but it is a real, deliberate behavior change and should be called out to
  anyone reviewing that history, not just discovered later.
- **`forbidden()` is an experimental Next.js API.** `experimental.authInterrupts` may change
  contract before Next.js stabilizes it; revisit this ADR if a Next.js upgrade changes or removes
  the flag.
- **One duplicated call site remains by design.** The FusionSolar route handlers under `app/api/**`
  still repeat the pre-Sprint-1A `auth()` + Prisma pattern, because `next/navigation`'s `redirect()`
  (and `forbidden()`) only work in Server Components/Actions — a Route Handler needs
  `NextResponse.redirect(...)` instead, a genuinely different primitive. Extending
  `lib/auth/session.ts` (or a sibling module) to cover Route Handlers is tracked as a Sprint 1B
  follow-up in `docs/ROADMAP.md`, not solved by this ADR.
- **No new UI for the 403 state.** Next's default fallback is generic ("This page could not be
  accessed"); a custom `forbidden.tsx` with Voltessa's own styling is future work, not done here.

## ADR-007: A single `DeviceTelemetry` table is Voltessa's own telemetry store

### Status

Accepted (Telemetry Platform Foundation milestone, commit `4e79e6f`). See
`docs/research/telemetry-platform-foundation.md` for the full engineering report and production
validation.

### Context

Every prior FusionSolar milestone read Huawei live, per request, with no persisted historical
record. Every future analytics feature (production curves, export/import totals, revenue,
historical charts) would otherwise require its own Huawei call and its own re-derivation of the
same raw KPIs, each with independent rate-limit exposure.

### Decision

`DeviceTelemetry` is one model — not split per device type (inverter/meter) or per resolution
(5m/1h/1d/future) — scoped by `organizationId`/`plantId`/`deviceId`, keyed on
`(deviceId, timestamp, resolution)` for idempotent writes (`createMany` +
`skipDuplicates: true`). Only the KPIs needed to derive produced/exported/imported energy are
typed columns (`activePower`, `inverterState`, `temperature` for inverters;
`meterActivePower`, `meterStatus`, `activeEnergy`, `reverseActiveEnergy` for meters); the complete
Huawei response item is preserved unmodified in a `rawPayload` JSON column so no KPI is ever
silently unavailable to a future analytics need. Huawei becomes one *producer* into this table via
a pure importer (`lib/fusionsolar/import-device-telemetry.ts`) with no HTTP awareness — matching
this codebase's existing Controller/Service split (`docs/CONVENTIONS.md`).

Revenue, profit, savings, self-consumption, and export decisions are explicitly never stored here
— they are derived values that belong to a higher layer and must always be computable from this
table's raw data.

### Consequences

- Dashboard, Market, and automation are unaffected by this change — nothing reads from
  `DeviceTelemetry` yet. Switching them over is separate, future work.
- The historical-KPI request contract this importer relies on
  (`devIds`/`devTypeId`/`collectTime`) was confirmed, not assumed — a newer
  `devDn`/`startTime`/`endTime` contract exists in current Huawei documentation but was proven to
  fail against this production tenant (`failCode 20011`); see the research doc for the diagnostic
  evidence.
- Schema was applied via `prisma db push`, matching the database's actual, already-diverged
  migration state (see the research doc §2) rather than adding a second out-of-sync migration
  file.
- The bootstrap importer (today + yesterday only, manual `CRON_SECRET`-gated trigger, no cron) is
  intentionally narrow — backfilling older history and populating `HOURLY`/`DAILY` resolutions are
  both future work the schema already accommodates but does not yet perform.
