# Development Workflow

## Local setup

From `platform/`:

```sh
pnpm install                        # installs all workspaces; postinstall runs `prisma generate` for apps/web
```

`apps/web` needs a reachable Postgres database and the env vars listed below in
`apps/web/.env.local` (there is already an `.env` / `.env.local` in the repo for local work — never
commit real secret values to a new file; see `docs/AI_PLAYBOOK.md`).

```sh
turbo dev --filter=web              # http://localhost:3000
turbo dev --filter=api              # http://localhost:3001 (apps/api is a standalone prototype, see CLAUDE.md)
```

If you changed `apps/web/prisma/schema.prisma`, run `pnpm --filter web prisma:generate` (or just
`pnpm install`, which triggers it) before the type checker or dev server will pick up the new
Prisma types.

## Branching strategy

Today, Voltessa is built by a single engineer committing directly to `main`; there is one other
branch, `feature/bootstrap`, from the initial scaffold, currently identical to `main`. There are no
merge commits in the history — everything has landed as a fast-forward onto `main`.

Going forward, use this convention (it's what the commit history already implies through its
`type(scope)` grouping — see below):

- `main` is always deployable. `apps/web` auto-deploys from `main` on Vercel
  (`apps/web/vercel.json`), so a broken `main` is a broken production app.
- For anything beyond a trivial fix, branch as `feature/<scope>-<short-description>`,
  `fix/<scope>-<short-description>`, or `refactor/<scope>-<short-description>`, using the same
  scopes as the commit convention below (e.g. `feature/fusionsolar-device-sync`,
  `fix/auth-callback-redirect`).
- Once there is more than one contributor, or the change touches automation/decision logic or the
  FusionSolar OAuth/gateway integration (see `docs/AI_PLAYBOOK.md`), open a PR against `main` and
  get it reviewed using the checklist below instead of pushing straight to `main`.
- Don't leave long-lived, diverging branches — this repo has no CI to keep them in sync, so drift
  is caught manually.

## Commit conventions

The git history already follows Conventional Commits in practice: `type(scope): summary`, lowercase,
imperative mood, no trailing period. Keep using it.

Types actually used in this repo:

| Type | Meaning |
|---|---|
| `feat` | New user-facing or API-facing capability |
| `fix` | Bug fix |
| `refactor` | Restructuring without behavior change |
| `chore` | Tooling/config/env changes (e.g. `chore(env): configure FusionSolar OAuth variables`) |
| `docs` | Documentation only |
| `debug` | Temporary diagnostic logging/instrumentation added while chasing a live issue |

Scopes actually used: `fusionsolar`, `auth`, `web`, `api`, `ui`, `dashboard`, `onboarding`, `ts`,
`prisma`, `env`, `core`, `app`, `marketing`. Use an existing scope when the change fits one; invent
a new one only when it genuinely doesn't (e.g. a new domain area).

Notes specific to this repo:

- `debug(...)` commits are fine while actively chasing a production issue (this is exactly how the
  FusionSolar OAuth flow got hardened — see the long `debug(fusionsolar): log OAuth authorization
  URL` sequence in the history), but don't leave debug logging permanently in place once the issue
  is resolved; follow up with a `fix`/`chore` commit that removes or downgrades it.
- Per `docs/CONVENTIONS.md`: one user story = one commit where practical. Don't bundle an unrelated
  refactor into a feature commit.
- Revert with `git revert`, keeping the standard "Revert \"...\"" message (see commit `853893d`),
  not by force-pushing over history.

## Review checklist

Whether it's self-review before pushing to `main` or a PR review once there's a second reviewer,
check:

- [ ] `turbo lint` and `turbo check-types` pass for every workspace touched.
- [ ] `turbo build --filter=web` succeeds (Next.js build errors are easy to miss in dev mode).
- [ ] No `.env*` file, access token, or client secret is included in the diff.
- [ ] If `prisma/schema.prisma` changed: the migration strategy (`db push` vs. a generated
      migration) is stated explicitly, every new tenant-scoped model has an `organizationId`
      foreign key, and money/measurement fields use `Decimal` with an explicit precision (see
      `docs/CODING_STANDARDS.md`).
- [ ] If the change touches `DecisionService`/`AutomationService`/threshold logic or
      `lib/fusionsolar/*`: the reasoning is explained in the commit message or PR description, not
      just the diff (see `docs/AI_PLAYBOOK.md` — this code has real financial impact).
- [ ] If a new role-gated action was added: it's checked against `lib/auth/permissions.ts`
      (`Permissions.canManagePlants` / `canOperatePlants` / `canViewPlants` /
      `canManagePlatform`), not hand-rolled.
- [ ] If a new env var was introduced: it's added to `turbo.json` `globalEnv` and documented in
      `CLAUDE.md`'s configuration section.
- [ ] If a structural/architectural decision was made: an ADR was added to
      `docs/ARCHITECT_DECISIONS.md`.
- [ ] `docs/BACKLOG.md` / `docs/ROADMAP.md` updated if the change completes or starts a tracked
      item.

## Deployment workflow

- **`apps/web`** deploys to **Vercel**, configured via `apps/web/vercel.json`. FusionSolar-related
  route handlers (`app/api/auth/fusionsolar/callback`, the `fusionsolar-*` diagnostic routes under
  `app/api/diag`) are pinned to the `fra1` (Frankfurt) region — keep new FusionSolar-related
  serverless routes in the same region unless you have a specific reason not to, since FusionSolar's
  API and the gateway proxy in front of it are EU-hosted.
- Deploys happen on push to `main` (standard Vercel Git integration) — there is no separate staging
  environment or CI gate today, which is why `main` must stay deployable at all times.
- Telemetry ingestion (`app/api/internal/fusionsolar/ingest-plant-telemetry`) is a bearer-token
  protected (`CRON_SECRET`) endpoint meant to be triggered externally on a schedule. Vercel's
  built-in cron was tried and reverted (commits `6643255` then `853893d`) — ingestion is **not**
  currently automatic. If you re-enable scheduled ingestion, investigate why the previous attempt
  was reverted before repeating it, and document the outcome.
- **`apps/api`** has no deployment configuration (no Dockerfile, no CI, no hosting config) and is
  not deployed anywhere. It stays a local/reference-only service until a decision is made to
  productionize it — see `docs/AI_PLAYBOOK.md` on not assuming it should be wired up.
- There is no CI pipeline (no `.github/workflows`) in this repo yet. Until one exists, `turbo lint`
  / `turbo check-types` / `turbo build` must be run locally before pushing to `main`.
