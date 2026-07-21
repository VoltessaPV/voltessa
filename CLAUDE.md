# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Voltessa is

Voltessa is an AI-powered renewable operations platform: it operates solar (and eventually other
renewable) assets on behalf of owners, rather than just providing a monitoring dashboard. The MVP
scope is Huawei FusionSolar plants, with automatic export stop/resume driven by electricity market
prices and configurable thresholds. See `docs/VISION.md` for the product vision and principles,
`docs/CLIENT_REQUIREMENTS.md` for the first customer's concrete requirements, and `docs/BACKLOG.md`
/ `docs/ROADMAP.md` for sprint status. Some docs (`ARCHITECTURE.md`, `CONVENTIONS.md`, ADRs) are
written in Bulgarian.

**This is a live system, not a sandbox.** `apps/web` holds a real Google OAuth login, a real
Postgres database, and a real Huawei FusionSolar OAuth connection for at least one customer plant.
Automation logic (export stop/resume thresholds) has direct financial consequences if it misfires.
Treat `lib/fusionsolar/*` and anything touching export/threshold decisions with care — see
`docs/AI_PLAYBOOK.md` before changing that code.

**Before touching any of: Huawei, FusionSolar, the gateway proxy, telemetry ingestion, the ENTSO-E
scheduler, systemd services/timers, or production infrastructure generally, read
`docs/infrastructure/scaleway-production.md` first.** That document is the authoritative operator
runbook for the Scaleway VM these all run on (or, for FusionSolar, run through) — SSH access, every
systemd service/timer (working directories, environment files, exact commands), the gateway's
allow-list mechanism (a huge source of confusing failures if skipped: a missing allow-list entry
produces `api_path_not_allowed`, which is easy to mistake for a Huawei-side or OAuth-scope problem
if you haven't read that section first), a debugging checklist per subsystem (gateway, telemetry,
ENTSO-E), and the mandatory inspect → explain → backup → modify → restart → verify procedure for any
change to that VM. Treat that document, not chat history, as the source of truth for this
infrastructure — do not guess at or re-derive VM/gateway behavior from a previous conversation, and
keep the runbook itself current when the infrastructure changes.

## Documentation map

| Doc                                                                                   | Read it when you need to know...                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE.md` (this file)                                                               | Architecture, repo layout, commands, high-level conventions                                                                                                                          |
| `docs/AI_PLAYBOOK.md`                                                                 | How an AI agent should behave in this specific repo — guardrails, what not to touch silently                                                                                         |
| `docs/infrastructure/scaleway-production.md`                                          | Operator runbook for the Scaleway VM — gateway proxy, allow-list, systemd services/timers, SSH/debugging SOP. Read before any Huawei/FusionSolar/gateway/cron/telemetry/ENTSO-E work |
| `docs/DEVELOPMENT_WORKFLOW.md`                                                        | Local setup, branching, commit conventions, PR/review process, deployment                                                                                                            |
| `docs/CODING_STANDARDS.md`                                                            | TypeScript/Prisma/Next.js/NestJS conventions, error handling, formatting                                                                                                             |
| `docs/FEATURE_CHECKLIST.md`                                                           | Step-by-step checklist for shipping a feature end-to-end                                                                                                                             |
| `docs/TESTING.md`                                                                     | What is (and isn't) tested today, and how to add tests                                                                                                                               |
| `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`, `docs/DECISIONS/*`                     | Original architecture/ADR docs (Bulgarian)                                                                                                                                           |
| `docs/VISION.md`, `docs/CLIENT_REQUIREMENTS.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md` | Product context, first-customer scope, sprint status                                                                                                                                 |
| `docs/PROJECT_CONTEXT.md`                                                             | Product-level framing — mission, vision, target customers, MVP vs. long-term scope                                                                                                   |
| `docs/ARCHITECT_DECISIONS.md`                                                         | ADR log and template, in English, alongside `docs/DECISIONS/*`                                                                                                                       |
| `docs/AI_TASK_TEMPLATE.md`                                                            | Template to scope any AI implementation task before starting it                                                                                                                      |

## Repo layout

This is a pnpm + Turborepo monorepo rooted at `platform/`.

- `apps/api` — a NestJS service. It is a **standalone architecture prototype** of the automation
  domain (Market/Decision/Plant/Automation services + a `PlantDriver` abstraction with a
  `MockDriver`). Nothing in `apps/web` calls it — there is no cross-service HTTP wiring today, and
  it has no deployment configuration. Treat it as the reference implementation of the pattern
  described in `docs/ARCHITECTURE.md` / ADR-001, not as a live backend.
- `apps/web` — the actual product: a Next.js 16 (App Router, React 19) app that is self-contained,
  with its own Postgres database (Prisma), NextAuth v5 (Google OAuth, database sessions) for
  authentication, and a real Huawei FusionSolar OAuth integration implemented directly as Next.js
  route handlers and server actions. This is where day-to-day feature work happens.
- `packages/ui` — shared React component library (`@repo/ui`), consumed via `workspace:*`.
- `packages/eslint-config`, `packages/typescript-config` — shared lint/tsconfig bases.
- `docs/` — product/architecture docs (vision, requirements, roadmap, backlog, ADRs) plus the
  engineering guides listed above.
- `docker/`, `business/` — present but currently empty; no containerization or business-ops
  tooling has landed yet. Don't assume conventions from these until they have content.

### `apps/web` internal structure — note the split

- `domains/*` and `services/*` (e.g. `domains/automation`, `services/market`, `lib/huawei`,
  `lib/market`, `server/actions`) are **intentional empty scaffolding** (`export {};`) from a
  domain-architecture refactor that was started (`refactor(core): introduce domain architecture`)
  but not carried through. They mark an intended future layout, not code that runs. Don't assume
  logic lives there just because the directory exists, and don't start filling them in on your own
  initiative — see `docs/AI_PLAYBOOK.md`.
- The real, working logic currently lives in `lib/fusionsolar/*` (OAuth flow, token refresh via a
  FusionSolar gateway proxy, station/device sync, telemetry ingestion), `lib/auth/*` (NextAuth
  config, roles, permissions, and — since Sprint 1A — the shared current-user/authorization layer
  in `lib/auth/session.ts`, see ADR-006 in `docs/ARCHITECT_DECISIONS.md`), `lib/prisma/*` (Prisma
  client singleton), `app/onboarding/actions.ts` (a real Server Action), and `components/dashboard/*`
  (UI).
- `app/(marketing)` is the public marketing site; `app/(platform)` is the authenticated
  operator/owner app (dashboard, plants, market, automations, alerts, settings), gated by
  `proxy.ts` (NextAuth middleware) for `/dashboard/:path*`.
- Every component under `app/` and `components/` is currently a React Server Component — there is
  no `"use client"` anywhere in the codebase yet. Add it only when you introduce genuine
  interactivity (state, effects, event handlers, browser APIs).

## Commands

Run from the repo root (`platform/`) unless noted. Package manager is **pnpm** (`packageManager:
pnpm@9.0.0`); Node >= 18.

```sh
pnpm install                       # install all workspace deps (runs `prisma generate` for web via postinstall)

turbo dev                          # run all apps in dev mode
turbo dev --filter=web             # web only, http://localhost:3000
turbo dev --filter=api             # api only, http://localhost:3001 (or $PORT)

turbo build                        # build all apps/packages
turbo build --filter=web

turbo lint                         # lint all workspaces
turbo check-types                  # typecheck all workspaces (web: `next typegen && tsc --noEmit`)

pnpm format                        # prettier --write across the repo (**/*.{ts,tsx,md})
```

`apps/api` tests — Jest, run from `apps/api/`:

```sh
pnpm test                          # unit tests (*.spec.ts)
pnpm test -- automation.service    # run a single test file by name pattern
pnpm test:watch
pnpm test:cov
pnpm test:e2e                      # e2e config in test/jest-e2e.json
```

`apps/web` has **no automated tests today** — see `docs/TESTING.md` for the current state and how
to add coverage.

`apps/web` Prisma:

```sh
pnpm prisma:generate                # regenerate Prisma client (postinstall does this automatically)
pnpm prisma:push                    # push schema.prisma to DATABASE_URL (used for most dev-time schema changes)
```

One migration is committed under `prisma/migrations/` alongside routine `db push` usage — see
`docs/CODING_STANDARDS.md` for when to use which.

## Configuration

Env vars declared in root `turbo.json` `globalEnv`: `DATABASE_URL`, `AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `FUSIONSOLAR_CLIENT_ID`,
`FUSIONSOLAR_CLIENT_SECRET`, `FUSIONSOLAR_REDIRECT_URI`, `FUSIONSOLAR_GATEWAY_URL` /
`FUSIONSOLAR_GATEWAY_SECRET` (a proxy/gateway service in front of the FusionSolar API — see
`lib/fusionsolar/api-client.ts` and `get-valid-access-token.ts`), `CRON_SECRET` (bearer-token guard
shared by every `app/api/internal/**` route — FusionSolar telemetry ingestion and the ENTSO-E price
refresh alike), and `ENTSOE_API_TOKEN` (ENTSO-E Transparency Platform `securityToken` — see
`lib/market-price/providers/entsoe.ts`; provisioned in Vercel Production/Preview only as of the
Continuous ENTSO-E Daily Price Refresh milestone — it was declared here and in `turbo.json` well
before that, but was never actually set as a Vercel value, so the price importer had silently never
worked in production until then).

Additional env var used in `apps/web` but **not currently declared** in `turbo.json` `globalEnv`
(known gap — add it if you touch this area): `NEXTAUTH_URL`.

## Architecture (automation domain, per `docs/ARCHITECTURE.md` / ADR-001)

```
AutomationService
    ├── MarketService       (current electricity price)
    ├── DecisionService     (price + thresholds -> STOP_EXPORT / RESUME_EXPORT)
    ├── PlantService        (plant state, export mode, command history)
    ├── PlantDriver         (interface, injected via DI — vendor-specific control)
    └── EventLog

PlantDriver implementations: HuaweiDriver -> FusionSolarClient -> FusionSolar API (planned),
MockDriver (current, used in apps/api), future KacoDriver etc.
```

Key rule (ADR-001): `AutomationService` depends on the `PlantDriver` interface, never on a
concrete vendor driver directly — the concrete driver is bound via Nest DI (see
`apps/api/src/app.module.ts`, `PLANT_DRIVER` token in `apps/api/src/drivers/constants.ts`). Adding
a new vendor should not require changing `AutomationService`.

In `apps/web`, the equivalent integration is vendor-specific today and lives directly under
`lib/fusionsolar/*` — there is no `PlantDriver`-style abstraction there yet. FusionSolar API calls
are not made directly from `apps/web`; they go through a gateway service (`FUSIONSOLAR_GATEWAY_URL`

- `FUSIONSOLAR_GATEWAY_SECRET`), and FusionSolar-related Vercel functions are pinned to the `fra1`
  region (see `apps/web/vercel.json`) — consistent with FusionSolar's EU-hosted API.

Production scheduling is **not** Vercel Cron — it was tried once for telemetry ingestion and
reverted (commits `6643255` / `853893d`, blocked on this Vercel plan tier). Instead, a Scaleway VM
that already existed for the FusionSolar gateway proxy (`voltessa-fusionsolar-proxy`, ADR-004) runs
two independent, `CRON_SECRET`-guarded `systemd` timers — no GitHub Actions, no Vercel Cron, exactly
these two:

- `voltessa-telemetry-ingestion.timer` — every 5 minutes, calls
  `app/api/internal/fusionsolar/bootstrap-device-telemetry` (writes `DeviceTelemetry`). See ADR-008.
- `voltessa-market-price-scheduler.timer` — triggers once daily at `14:00 Europe/Sofia` (shortly
  after ENTSO-E's real day-ahead publication window), running a script that polls
  `app/api/internal/market-price/refresh-prices?target=tomorrow` (writes
  `MarketPrice`/`MarketPriceImport`) every 30 minutes until a complete import succeeds or a bounded
  number of attempts is exhausted — all retry/stop logic lives in that script, not in application
  code. See ADR-009.

These two schedulers are deliberately independent (different cadence, different unit files,
different env files) — operational telemetry and market prices are different kinds of data with
different real-world refresh rates, not one problem with two speeds. Both live outside this
repository (the VM's `/etc/systemd/system/*` and `/etc/voltessa-*.env` are not version-controlled);
`docs/research/telemetry-platform-foundation.md` §8 and `docs/research/entsoe-price-scheduler.md`
are their authoritative record. The legacy `app/api/internal/fusionsolar/ingest-plant-telemetry`
route still exists but is no longer invoked by anything scheduled (superseded by
`bootstrap-device-telemetry`, ADR-008).

## Known gaps / tech debt (don't silently "fix" these — see `docs/AI_PLAYBOOK.md`)

- `apps/api/src/market.controller.ts` is an orphaned duplicate of
  `apps/api/src/market/market.controller.ts`; it is not registered in `app.module.ts` and is dead
  code.
- `apps/web` has zero automated tests (see `docs/TESTING.md`).
- CI (`.github/workflows/ci.yml`) runs lint, type-check and build on push/PR, but does not run
  tests (there is little to run — see `docs/TESTING.md`) and does not deploy; deployment stays on
  Vercel's Git integration (`docs/DEVELOPMENT_WORKFLOW.md`).
- `lib/result.ts` (`Result<T>`) and `lib/errors.ts` (`AppError`) exist but are not consistently
  used — most `lib/fusionsolar/*` code throws plain `Error`/custom error classes directly instead.
- `lib/logger.ts` exists but most error paths call `console.error`/`console.log` directly instead
  of the logger.

## Conventions (`docs/CONVENTIONS.md`)

- Controllers contain only HTTP logic; Services contain business logic; Drivers talk to
  manufacturer/vendor systems; Clients talk to external APIs.
- Use `import type` for interfaces/types.
- One user story = one commit. Update docs when a feature is completed. No temporary/throwaway
  solutions. Architectural decisions are recorded as ADRs — new ones go in
  `docs/ARCHITECT_DECISIONS.md` (template included there), continuing after ADR-001 in
  `docs/DECISIONS/ADR-001-automation-driver.md`.
- Engineering principles from `docs/VISION.md`: English is the development language (docs
  sometimes lag in Bulgarian); multi-tenancy is mandatory (see `Organization` in
  `prisma/schema.prisma`); providers/vendors are abstracted behind a common interface; business
  logic never lives inside UI components; every automated action must be explainable/traceable.

Full style rules (TypeScript, Prisma, Next.js, NestJS, formatting) live in
`docs/CODING_STANDARDS.md`. Branching, commits, review and deployment live in
`docs/DEVELOPMENT_WORKFLOW.md`.

## Engineering Principles

Foundational principles behind how Voltessa is — and should be — built, distilled from
`docs/VISION.md`, `docs/CONVENTIONS.md`, and the decisions in `docs/ARCHITECT_DECISIONS.md`.
"Working Rules" below is the operational checklist; these are the reasoning behind it — use them to
judge situations the checklist doesn't explicitly cover.

- **Simplicity over cleverness.** Per `docs/VISION.md`: "simplicity beats cleverness." A plain
  comparison in `DecisionService.decide()` beats a generic rules engine nobody asked for. Don't add
  a library, abstraction, or configuration surface the current MVP scope
  (`docs/CLIENT_REQUIREMENTS.md`) doesn't need.
- **Reliability over speed.** Voltessa controls real plant export behavior; a fast but flaky
  automation cycle is worse than a slower, correct one. `getValidFusionSolarAccessToken` retries
  only specific, known-transient network error codes (`RETRYABLE_NETWORK_ERROR_CODES`) instead of
  retrying everything — reliability comes from being precise about failure modes, not from blanket
  retrying.
- **Explainability over magic.** Every automated decision must be traceable back to a reason, not
  just an outcome. `AutomationService.evaluate()` returns `market`, `price`, `threshold`, `command`,
  and `reason` together, never just "command sent." Any new automation/AI logic must preserve this —
  a decision without a stated reason isn't acceptable, even when the decision itself is correct.
- **Multi-tenancy first.** Every tenant-scoped Prisma model carries `organizationId` from its first
  commit, not retrofitted later (ADR-002, `docs/ARCHITECT_DECISIONS.md`). A new model without
  `organizationId` is a design defect, not a follow-up task.
- **Automation must always be traceable.** Beyond a single decision's explainability:
  `PlantService.saveCommand()` records what was sent and whether it succeeded, and
  `docs/CLIENT_REQUIREMENTS.md` explicitly requires an event log and "no duplicate commands." Any
  code that changes a plant's state must leave a record of what happened and why — untraceable
  automation is a regression even if it otherwise "works."
- **Security before convenience.** Bearer-token checks use `crypto.timingSafeEqual`, not `===`
  (`app/api/internal/fusionsolar/ingest-plant-telemetry`); authorization goes through
  `lib/auth/permissions.ts`'s `Permissions.can*`, never an inline role check added "just for this
  one screen." A shortcut that skips auth or leaks timing information isn't acceptable even when it
  ships a feature faster.
- **Every external integration must be replaceable.** `AutomationService` depends on the
  `PlantDriver` interface, never on `HuaweiDriver` directly (ADR-001); FusionSolar API access goes
  through a swappable gateway boundary rather than being called inline everywhere it's needed
  (ADR-004). A second vendor (KACO, SMA, ...) should be addable without touching the automation
  core — code written directly against one vendor's API from inside shared logic is a design smell.
- **Prefer composition over duplication.** Reuse `getValidFusionSolarAccessToken`,
  `callFusionSolarApi`, `Permissions.can*`, and `lib/routes.ts` rather than writing a parallel
  version with slightly different behavior. The codebase already has two unrelated "automation
  domain" implementations (`apps/api` and `apps/web` — see "Repo layout") from moving fast under
  time pressure; don't add a third instead of composing with what already exists.

## AI Operating Principles

How an AI agent should work inside this repository, every time, regardless of how small the task
looks. Skipping steps here is how the codebase ends up with the duplication and drift already
documented in "Known gaps" above (the orphaned `market.controller.ts`, the unused `Result`/
`AppError`/`logger` conventions, the paused domain-architecture migration) — don't add to that list.

1. **Understand the task.** Restate it in terms of Voltessa's domain (plant, organization, export
   mode, threshold, FusionSolar connection), not generic CRUD terms. If the request is ambiguous
   about scope (e.g. touches automation/decision logic, or could belong in either `apps/api` or
   `apps/web`), resolve that ambiguity before writing code — see `docs/AI_PLAYBOOK.md`.
2. **Read relevant documentation.** At minimum: this file, `docs/AI_PLAYBOOK.md`, and whichever of
   `docs/CODING_STANDARDS.md` / `docs/ARCHITECT_DECISIONS.md` / `docs/PROJECT_CONTEXT.md` bears on
   the area you're touching. Don't rely on memory of a prior session — docs here change as the
   product does.
3. **Search for existing implementation.** Grep for the capability before assuming it doesn't
   exist — e.g. token refresh already exists in `getValidFusionSolarAccessToken`, permission checks
   already exist in `lib/auth/permissions.ts`, route-constant handling already exists in
   `lib/routes.ts`. Remember the empty `domains/`/`services/` stubs are not "existing
   implementation" — the real logic is usually in `lib/*` or directly under `app/`.
4. **Reuse existing architecture.** Follow the `PlantDriver` DI pattern (`apps/api`), the
   FusionSolar gateway pattern (`apps/web`), the `Permissions.can*` RBAC pattern, and the Prisma
   multi-tenancy pattern (`organizationId` + composite `@@unique`) rather than inventing a parallel
   mechanism. See `docs/CODING_STANDARDS.md`.
5. **Avoid duplication.** If a helper, type, or check already exists (token refresh, Decimal
   parsing, role checks, route constants), import and reuse it instead of writing a local copy,
   even a slightly different one.
6. **Produce a short implementation plan** before editing files — use `docs/AI_TASK_TEMPLATE.md`
   as the shape (Goal, Context, Acceptance Criteria, Constraints, Files likely affected, Risks,
   Validation Steps, Definition of Done). For anything touching automation/decision logic or the
   FusionSolar integration, share the plan before implementing (see `docs/AI_PLAYBOOK.md` — real
   financial impact).
7. **Implement**, following `docs/CODING_STANDARDS.md` and the file/module conventions already in
   the area you're editing.
8. **Run validation** — `pnpm lint`, `turbo check-types`, `turbo build`, and `pnpm --filter api
test` if `apps/api` was touched. See "Definition of Done" below; these are not optional even for
   small changes.
9. **Summarize changes** — what changed, why, which files, and any follow-up needed (docs updated,
   ADR added, env var declared, etc.), per `docs/FEATURE_CHECKLIST.md`.

## Autonomous Milestone Execution

This repository is developed through milestone-based engineering.

When the user starts a milestone, execute it from beginning to end without asking for confirmation
between intermediate steps.

Treat the following as routine parts of completing a milestone:

- editing files
- running shell commands
- creating temporary diagnostics
- Playwright
- Prisma
- lint
- typecheck
- build
- local verification
- git add
- git commit
- git push
- waiting for GitHub Actions
- waiting for Vercel
- production verification
- removing temporary diagnostic artifacts created during the milestone

Do not ask:

"Should I continue?"

"Should I commit?"

"Should I push?"

"Should I verify production?"

These are all considered part of the milestone.

Only stop when one of these is genuinely true:

- the specification is ambiguous
- user input is required
- credentials or secrets are unavailable
- a cloud resource must be manually created
- a cloud resource must be manually deleted

Everything else should be executed autonomously.

## Diagnostic Scripts

Temporary diagnostic scripts are allowed.

Prefer using existing tooling.

If a temporary script is required:

- create it
- execute it
- delete it before finishing the milestone

Never leave temporary diagnostic artifacts inside the repository.

## Tool Usage

The preferred workflow for steps 2–5 of "AI Operating Principles" above, stated as concrete rules
for which tool answers which question. The point is the same one made throughout this file: this
repo has real history and real prior decisions behind it, so read them instead of guessing.

- **Prefer reading existing code over assumptions.** Before describing what a service, route, or
  Prisma model does, open it. Don't assume `AutomationService.evaluate()` treats
  `stopExportThreshold` and `resumeExportThreshold` independently without reading
  `apps/api/src/automation/automation.service.ts` — it currently derives both from the same
  `plant.automation.stopExportThreshold`, which is exactly the kind of detail that's invisible
  until you read the file.
- **Use Git history before guessing why code exists.** `git log --oneline -- <file>` and `git log
-p -- <file>` explain intent the code alone doesn't. The long `debug(fusionsolar): log OAuth
authorization URL` sequence explains why the token-refresh retry logic only retries specific
  network error codes; the revert of Vercel cron scheduling (commits `6643255` then `853893d`)
  explains why telemetry ingestion isn't automatic today. Don't guess at "why" when `git log` can
  answer it directly.
- **Prefer repository search before creating new files.** Grep for the capability (a helper, a
  type, a route, an env var) across `apps/api`, `apps/web`, and `packages/` before adding a new
  file for it. Search file _contents_, not just directory names — the empty `domains/`/`services/`
  stubs will match a path-based search but hold no real implementation.
- **Prefer existing documentation before generating new documentation.** Check the documentation
  map above for a doc that already covers the topic before writing a new one. If an existing doc is
  close but incomplete, extend it — see how `docs/ARCHITECT_DECISIONS.md` continues
  `docs/DECISIONS/ADR-001-automation-driver.md` rather than duplicating it — instead of creating a
  parallel doc that will drift out of sync.
- **Use GitHub history when investigating regressions.** For "when did this break" or "why does
  this look different from what I expected," use `git log`/`git blame` on the affected file(s), and
  the GitHub PR/issue history once PRs exist, rather than guessing from the current diff alone.
- **Never invent configuration values.** If a threshold, region, URL, or timeout isn't in the code
  or in `docs/`, don't fabricate a plausible-looking one — read it from
  `apps/api/src/plant/plant.service.ts`, `apps/web/vercel.json`, `turbo.json`, etc., or ask.
- **Never invent environment variables.** Only use env vars that are actually read via
  `process.env` somewhere in the code, or already listed in the Configuration section above. If a
  task genuinely needs a new one, add it explicitly (and declare it in `turbo.json` `globalEnv`)
  rather than assuming one already exists under a guessed name.
- **Never invent APIs.** Confirm a FusionSolar gateway endpoint, Prisma model/field, or internal
  helper exists in the code before calling it — see the same rule under "Never" below.

## Definition of Done

A task is **not** complete until all of the following are true:

- Acceptance criteria (as stated in the task, or in `docs/AI_TASK_TEMPLATE.md` if one was written)
  are satisfied.
- `pnpm lint` passes.
- `turbo check-types` passes.
- `turbo build` passes.
- No TypeScript errors remain, anywhere in the workspaces touched — not just in the files you
  edited.
- No unrelated files were modified. A dead-code cleanup, formatting pass, or refactor spotted along
  the way gets flagged to the user, not folded silently into the diff.
- Documentation is updated when necessary — `CLAUDE.md` for repo-wide facts, `docs/CODING_STANDARDS.md`
  for a new convention, `docs/ARCHITECT_DECISIONS.md` for a structural decision, `docs/BACKLOG.md` /
  `docs/ROADMAP.md` if a tracked item was completed. See `docs/FEATURE_CHECKLIST.md` for the full
  checklist.

## Working Rules

Always:

- **Reuse existing patterns** — Controller/Service/Driver/Client in `apps/api`, the
  `lib/fusionsolar`-style flat structure in `apps/web`, the gateway-proxy pattern for external
  vendor calls.
- **Keep architecture consistent** — don't introduce a second way to do something the codebase
  already does one way (a second RBAC mechanism, a second Prisma client instantiation, a second
  retry helper).
- **Preserve multi-tenancy** — every tenant-scoped model/query carries `organizationId`; never
  write a query that could leak or mutate another organization's data.
- **Preserve RBAC** — route/action authorization goes through `lib/auth/permissions.ts`'s
  `Permissions.can*` buckets and `lib/auth/roles.ts`'s `Roles`, not inline role string comparisons.
- **Preserve vendor abstraction** — automation/control logic depends on the `PlantDriver` interface
  (or the equivalent gateway abstraction in `apps/web`), never on a concrete vendor (Huawei/KACO/
  SMA/...) directly, per ADR-001.
- **Prefer simple solutions** — per `docs/VISION.md`, "simplicity beats cleverness"; don't add a
  library, layer, or abstraction the task doesn't need.
- **Keep commits focused** — one user story per commit, `type(scope): summary`, per
  `docs/DEVELOPMENT_WORKFLOW.md`.

## Never

Never:

- **Invent APIs** — don't call a FusionSolar/gateway endpoint, Prisma model/field, or internal
  helper that doesn't exist; verify it in the code first.
- **Hardcode secrets** — no token, client secret, `CRON_SECRET`, or `FUSIONSOLAR_GATEWAY_SECRET`
  value ever appears in source, logs, commits, or docs. Use `process.env`.
- **Bypass authentication** — every protected route/action goes through NextAuth (`auth()`,
  `proxy.ts`'s middleware) or the equivalent Nest guard; don't add a shortcut for convenience.
- **Bypass authorization** — don't skip a `Permissions.can*` check because it's "just for now" or
  the caller is assumed trusted.
- **Duplicate business logic** — don't reimplement decision/threshold logic, token refresh, or
  permission checks locally instead of importing the existing implementation.
- **Silently change architecture** — a new abstraction, a new cross-cutting pattern, or a decision
  to wire `apps/api` and `apps/web` together is a decision for the user, recorded as an ADR in
  `docs/ARCHITECT_DECISIONS.md` — not something to do unasked mid-task.
- **Ignore failing builds** — a failing `pnpm lint` / `turbo check-types` / `turbo build` blocks
  the task; fix it or stop and explain why, don't report the task done anyway.
- **Modify unrelated files** — including formatting-only changes to files outside the task's scope,
  even ones that look inconsistent (see `docs/CODING_STANDARDS.md`'s note on pre-existing
  formatting drift — flag it, don't fix it as a drive-by).

## Practices Validated in Sprint 1A

Sprint 1A (centralizing session/current-user/organization/role lookup into `lib/auth/session.ts`
and enforcing the previously-dormant `Permissions.can*` model — see ADR-006 in
`docs/ARCHITECT_DECISIONS.md`) is the first sprint completed under the "AI Operating Principles" /
"Working Rules" / "Never" rules above. These five practices aren't new — they're already implied
above — but Sprint 1A is concrete evidence they hold up in this repo, not just aspirational:

- **Always analyze before implementing.** The architecture report written before any code changed
  found the actual gap — `Permissions.can*` was defined but imported nowhere — instead of guessing
  at what to centralize. Implementing first would have meant fixing a guessed-at problem.
- **Do not modify unrelated code.** The refactor touched exactly the files with the duplicated
  `auth()` + Prisma-lookup pattern and nothing else: not `app/onboarding/actions.ts` (explicitly
  out of scope, and still a deliberate exception — see the updated Next.js conventions in
  `docs/CODING_STANDARDS.md`), not the FusionSolar route handlers (they use `NextResponse.redirect`,
  not `next/navigation`'s `redirect`, so reusing the same helper would have changed behavior), and
  not `packages/ui` (pre-existing, unrelated breakage — see below).
- **Keep implementation within the approved sprint scope.** "No `Membership`, no schema changes, no
  new routes unless necessary" were stated constraints the work was checked against, not just
  described after the fact — `prisma/schema.prisma` was never touched, no `Membership` model was
  introduced, and the only new configuration is the one Next.js flag (`experimental.authInterrupts`)
  genuinely required by `forbidden()`.
- **Run validation before considering a task complete.** Running the full, unscoped `pnpm lint` /
  `turbo check-types` / `turbo build` — not just `--filter=web` — surfaced a real, pre-existing
  failure in `packages/ui` that had nothing to do with the change and would otherwise have gone
  unnoticed.
- **Report pre-existing issues separately instead of fixing them automatically.** The `packages/ui`
  failure was confirmed pre-existing via `git stash` (it reproduced identically on a clean `main`)
  and reported as a known issue rather than silently fixed as a drive-by — fixing it would have been
  exactly the "modify unrelated files" mistake the rule above exists to prevent.
