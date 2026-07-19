# AI Playbook

How an AI coding agent (Claude Code or otherwise) should operate specifically in the Voltessa
repo. This is not a generic "AI best practices" document — every rule below exists because of
something true about this codebase's current state. Read `CLAUDE.md` first for the architecture
overview this playbook assumes.

## The stakes are real

`apps/web` is a live system with a real Google OAuth login, a real Postgres database, and a real
Huawei FusionSolar OAuth connection to at least one customer's plant (`docs/CLIENT_REQUIREMENTS.md`
describes that first customer's actual requirements). `DecisionService` / the automation logic
decides when a plant stops exporting electricity to the grid. If that logic misfires — wrong
threshold comparison, a duplicate command sent, a sign error — the customer loses real revenue or
the plant behaves unsafely. Treat any change touching:

- `apps/api/src/decision/*`, `apps/api/src/automation/*` (the reference decision logic), or
- `apps/web/lib/fusionsolar/*` (the live OAuth/token/gateway integration)

with the same care you'd give a payments system, not a CRUD screen. Prefer smaller, explicit
diffs, explain the reasoning for threshold/comparison logic in the commit message, and flag the
change clearly to the user rather than bundling it into an unrelated commit.

## Two implementations, one is not "broken"

`apps/api` (NestJS) and `apps/web` (Next.js) both contain automation/plant/FusionSolar-shaped code,
but they are not the same system and are not wired together. `apps/api` is the clean reference
architecture from `docs/ARCHITECTURE.md` / ADR-001 (Controller → Service → Driver → Client,
`PlantDriver` behind DI); `apps/web` is the real product, built faster and more directly against
Prisma and Next.js route handlers/server actions. Do not:

- "Fix" `apps/web` by wiring it to call `apps/api`, or vice versa, unless explicitly asked.
- Assume `apps/api`'s in-memory `PlantService` (`apps/api/src/plant/plant.service.ts`, one
  hardcoded `Demo Plant`) reflects real data — it doesn't; real plant data is in
  `apps/web/prisma/schema.prisma`.
- Treat the orphaned `apps/api/src/market.controller.ts` duplicate as something to silently clean
  up mid-task — mention it, but don't fix unrelated dead code as a drive-by in a feature change.

## The empty `domains/` and `services/` stubs are deliberate, not missing code

`apps/web/domains/*`, `apps/web/services/*`, `apps/web/server/actions/*`, `apps/web/lib/huawei`,
and `apps/web/lib/market` are all just `export {};`. They came from a single commit
(`refactor(core): introduce domain architecture`) that started a domain-driven restructure and was
never continued — real logic still lives directly in `apps/web/lib/fusionsolar/*`,
`apps/web/lib/auth/*`, and route handlers/server actions in `apps/web/app/**`.

- Do not start implementing these stub directories on your own initiative because they "look
  unfinished." That's a deliberate architectural migration the user hasn't asked for yet.
- If a task naturally requires adding logic that conceptually belongs in one of these domains, ask
  whether to place it there (continuing the migration) or alongside the existing `lib/fusionsolar`
  style (following current precedent). Don't decide unilaterally — the two styles have different
  implications for the rest of the codebase.

## Secrets and credentials

Never read, print, log, or commit the contents of `apps/web/.env` or `apps/web/.env.local`. If you
need to know whether a variable is configured, check for its **name**, not its value (see the
pattern used to build the env var table in `CLAUDE.md`). Relevant secrets in this repo:
`DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_SECRET`, `FUSIONSOLAR_CLIENT_SECRET`,
`FUSIONSOLAR_GATEWAY_SECRET`, `CRON_SECRET`. Before any commit, check `git status`/`git diff` for
accidental inclusion of `.env*` files — they are gitignored, but don't assume that protects you if
someone force-adds one.

## Prisma changes need a stated migration strategy

The repo currently mixes `prisma db push` (used for most schema evolution so far) with one
committed migration under `prisma/migrations/`. Don't assume either approach — when a task requires
a schema change, say explicitly whether you're using `db push` or generating a migration, and
prefer matching whatever the most recent schema change in `git log -- apps/web/prisma/schema.prisma`
did, unless the user says otherwise. See `docs/CODING_STANDARDS.md` for the multi-tenant modeling
conventions (`organizationId` on every tenant-scoped model, composite `@@unique` keys) that any new
model must follow.

## FusionSolar integration code has been hardened through real production debugging

The long run of `debug(fusionsolar): log OAuth authorization URL` / `fix(fusionsolar): ...` commits
in the git history was the process of getting the OAuth flow, gateway proxying, and token-refresh
retry logic (`lib/fusionsolar/get-valid-access-token.ts`) working against the real FusionSolar
gateway. Specific patterns in that code exist for real reasons — don't simplify them away without
understanding why they're there:

- The retry loop only retries on a specific allow-list of network error codes
  (`RETRYABLE_NETWORK_ERROR_CODES`), not all failures.
- `secretsMatch()` in the telemetry ingestion route uses `crypto.timingSafeEqual` deliberately, not
  a plain `===` comparison.
- Vercel region pinning (`fra1`) on FusionSolar-related routes in `apps/web/vercel.json` is
  intentional — don't remove it without knowing why.

## Docs are part of "done" here

`docs/CONVENTIONS.md` states: after every completed feature, documentation is updated, and
architectural decisions are recorded as ADRs. When you finish a non-trivial change:

- Update `docs/BACKLOG.md` / `docs/ROADMAP.md` if it moves a tracked item, if asked to.
- Add an ADR to `docs/ARCHITECT_DECISIONS.md` (using its template, continuing the numbering after
  ADR-001, which lives in `docs/DECISIONS/ADR-001-automation-driver.md`) if you made a structural decision (a new
  abstraction, a new cross-cutting pattern, a vendor/library choice), not for routine feature work.
- Update `CLAUDE.md` if you changed commands, repo layout, or added a new app/package.
- Use `docs/FEATURE_CHECKLIST.md` before considering a feature complete.

## Scope discipline

Per the project's own engineering principles (`docs/VISION.md`): simplicity beats cleverness, no
temporary/throwaway solutions, and every feature must solve a real operational problem. Concretely
for this repo, that means: don't add abstraction layers "for the future" beyond what's already
scaffolded (`domains/`, `services/`), don't introduce a new state-management/data-fetching library
when a Server Component + Prisma call already does the job, and don't refactor unrelated code while
fixing something else — flag it instead and let the user decide.

## Autonomous milestone execution

When the user frames a task as a **milestone** with an explicit spec (goal, constraints, a
deliverable/validation checklist), execute it end-to-end without pausing for confirmation between
steps — editing files, running shell commands, Prisma/migrations, Playwright, lint/typecheck/build,
local verification, `git add`/`commit`/`push`, waiting on GitHub Actions, waiting on Vercel, and
production verification are all routine parts of *finishing* a milestone the user already scoped,
not separate decisions each requiring a check-in. Report progress as you go; don't ask "should I
continue?" between steps that were already specified.

This applies specifically to scoped milestone work, not to every interaction — a one-off question,
an ambiguous request, or exploratory back-and-forth still gets the normal judgment calls described
elsewhere in this playbook.

Stop and ask only when one of these is genuinely true:

- User input is required (an ambiguous requirement the spec doesn't resolve, a design choice the
  user should make, not you).
- Credentials or secrets are missing and unobtainable in this environment (e.g. this sandbox
  redacts real secret values used by local dev — see `git log` on the FusionSolar diagnostic
  milestones for the established pattern: push and verify against production instead, or ask the
  user to run one command with the real secret and paste back the result).
- A cloud resource must be created or deleted manually (a new Vercel project, rotating a
  production secret, deleting a database) — these are exactly the "hard to reverse, affects shared
  systems" actions the top-level system instructions already gate on explicit confirmation.
- The milestone specification is genuinely ambiguous in a way that changes the implementation, not
  just a stylistic judgment call.

Everything else in the "Working Rules" / "Never" sections of `CLAUDE.md` — reuse existing patterns,
preserve multi-tenancy/RBAC/vendor abstraction, don't invent APIs/env vars, don't modify unrelated
files, run the full validation suite before calling anything done — still applies at full strength.
Autonomy is about not pausing for permission on steps already implied by the milestone spec; it is
not permission to skip validation, expand scope, or take a destructive/hard-to-reverse action
without the confirmation that action would otherwise require.
