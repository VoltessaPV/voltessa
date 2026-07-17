# Feature Checklist

A working checklist for taking a Voltessa feature from idea to shipped. Not every item applies to
every change — a copy tweak doesn't need a Prisma section — but check each section explicitly
rather than skipping silently.

## 1. Scope it against the product

- [ ] Does this serve the MVP scope in `docs/CLIENT_REQUIREMENTS.md` (Huawei FusionSolar,
      single-plant automation, configurable thresholds, event log, remote management, no local
      hardware) or an explicitly tracked item in `docs/BACKLOG.md` / `docs/ROADMAP.md`? If neither,
      confirm scope with the user before building — per `docs/VISION.md`: "Does this help Voltessa
      operate renewable assets more efficiently? If the answer is no, it is probably not a
      priority."
- [ ] If it's automation/decision-affecting (thresholds, export mode, command dispatch), re-read
      the "Financial impact" guidance in `docs/AI_PLAYBOOK.md` before writing code.

## 2. Decide where it lives

- [ ] `apps/web` unless you were explicitly asked to build in the `apps/api` prototype (see
      `CLAUDE.md` on the two-implementation split).
- [ ] Decide: does this belong in the existing `lib/fusionsolar`-style flat structure, or in the
      scaffolded `domains/`/`services/` layout? Don't decide unilaterally — see
      `docs/AI_PLAYBOOK.md`.
- [ ] Check `lib/routes.ts` for an existing path constant before hardcoding a URL string; add one
      if this feature introduces a new top-level route.

## 3. Data model (if it touches Postgres)

- [ ] New/changed models follow the multi-tenancy and Decimal/unique-key conventions in
      `docs/CODING_STANDARDS.md` (Prisma section).
- [ ] Decided and stated explicitly: `prisma db push` vs. a generated migration.
- [ ] Ran `pnpm --filter web prisma:generate` (or `pnpm install`) so types are current before
      writing code against the new schema.

## 4. Auth & permissions (if it exposes a new action or route)

- [ ] New pages/actions under `app/(platform)/*` use `lib/auth/session.ts`'s
      `requireCurrentUser()` / `requireOnboardedUser()` / `requirePermission(allowedRoles)`
      (ADR-006, `docs/ARCHITECT_DECISIONS.md`) rather than calling `auth()` and looking the user up
      by hand — `proxy.ts`'s middleware only covers `/dashboard/:path*` and only checks "is logged
      in."
- [ ] Role-gated actions use `requirePermission(Permissions.can*)` for the right capability, not an
      inline role string comparison.
- [ ] If this is a new capability that doesn't fit an existing `Permissions.can*` bucket, decide
      with the user whether to extend the permissions model rather than bypassing it.

## 5. External integration (if it touches FusionSolar or another vendor)

- [ ] Goes through the existing gateway pattern (`FUSIONSOLAR_GATEWAY_URL` +
      `FUSIONSOLAR_GATEWAY_SECRET`, `lib/fusionsolar/api-client.ts`) rather than calling FusionSolar
      directly, unless there's a stated reason not to.
- [ ] Reuses `getValidFusionSolarAccessToken` for token freshness instead of re-implementing token
      refresh.
- [ ] Any new serverless route added for this integration is pinned to `fra1` in
      `apps/web/vercel.json`, matching the existing FusionSolar routes.
- [ ] New env vars required are added to `turbo.json` `globalEnv` and to the configuration table in
      `CLAUDE.md`.

## 6. Error handling & observability

- [ ] Expected, caller-handled failures use `Result<T>` (`lib/result.ts`) or a structured error
      class (pattern: `FusionSolarApiError`); unexpected failures throw and get caught at the route
      handler boundary.
- [ ] Log calls use `logger.*` (`lib/logger.ts`) with a `"[Context Name]"` prefix, matching
      existing FusionSolar logging, instead of ad hoc `console.log`.
- [ ] No secret values (tokens, `CRON_SECRET`, gateway secret) are ever logged, even at debug
      level.

## 7. Tests

- [ ] Read `docs/TESTING.md` first — `apps/web` currently has no automated tests, so adding the
      first test for a piece of logic is valuable; don't skip it just because nothing else in the
      file is tested.
- [ ] Pure logic (decision thresholds, retry/backoff helpers, permission checks, Decimal
      conversion helpers) gets a unit test even if the surrounding route handler doesn't.
- [ ] If working in `apps/api`, new services/controllers get a `*.spec.ts` following the existing
      Nest testing-module pattern (`app.controller.spec.ts`).

## 8. Quality gate before pushing

- [ ] `turbo lint` clean for every touched workspace.
- [ ] `turbo check-types` clean for every touched workspace.
- [ ] `turbo build --filter=web` succeeds if `apps/web` was touched.
- [ ] `pnpm format` run on touched files.
- [ ] `git status`/`git diff` reviewed for accidental `.env*` or secret inclusion.

## 9. Docs

- [ ] `docs/BACKLOG.md` / `docs/ROADMAP.md` updated if this completes or starts a tracked item.
- [ ] ADR added to `docs/ARCHITECT_DECISIONS.md` (using its template) if this introduced a new
      abstraction, cross-cutting pattern, or vendor/library choice (not for routine feature work).
- [ ] `CLAUDE.md` updated if commands, repo layout, or configuration changed.

## 10. Commit

- [ ] Commit message(s) follow `type(scope): summary` (`docs/DEVELOPMENT_WORKFLOW.md`), one user
      story per commit where practical.
- [ ] No leftover `debug(...)`-only commits without a following cleanup commit if you added
      temporary diagnostic logging while building the feature.
