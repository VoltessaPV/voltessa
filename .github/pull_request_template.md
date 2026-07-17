<!--
Voltessa PR template. See docs/DEVELOPMENT_WORKFLOW.md for the full review checklist and
docs/FEATURE_CHECKLIST.md for the end-to-end feature checklist this is drawn from. Delete a
section only if it is genuinely not applicable (e.g. "Database impact" for a copy-only change) —
don't leave sections blank.
-->

## Summary

<!-- What changed, in one or two sentences. Reference the plant/organization/automation domain
terms from docs/PROJECT_CONTEXT.md rather than generic terms. -->

## Motivation

<!-- Why this change: which docs/CLIENT_REQUIREMENTS.md requirement, docs/BACKLOG.md /
docs/ROADMAP.md item, bug, or explicit ask does this address? Link it if it's tracked. -->

## Architecture impact

<!-- Does this introduce a new abstraction, cross-cutting pattern, or vendor/library choice? If
yes, has an ADR been added to docs/ARCHITECT_DECISIONS.md? Does this touch the apps/api vs
apps/web split, the PlantDriver abstraction, or the FusionSolar gateway pattern
(docs/ARCHITECT_DECISIONS.md ADR-001/ADR-004)? If none of this applies, say "None." -->

- [ ] No architectural change, OR
- [ ] Architectural change made — ADR added/updated in `docs/ARCHITECT_DECISIONS.md`

## Database impact

<!-- Does this change apps/web/prisma/schema.prisma? If so: `prisma db push` or a generated
migration — which, and why? Does every new tenant-scoped model carry `organizationId`? Any data
backfill needed? If no schema change, say "None." -->

- [ ] No schema change, OR
- [ ] Schema changed — migration strategy stated, multi-tenancy (`organizationId`) preserved

## Security impact

<!-- Auth/authz: does this add or change a protected route, Server Action, or role-gated
capability? Does it go through `lib/auth/permissions.ts`'s `Permissions.can*`, not an inline role
check? Any new secret/env var introduced (and added to `turbo.json` globalEnv + CLAUDE.md)? Any
change to how FusionSolar tokens/gateway secrets are handled? -->

- [ ] No auth/authz/secrets impact, OR
- [ ] Impact described above, and reviewed against `docs/AI_PLAYBOOK.md` / `CLAUDE.md`'s "Never"
      list (no bypassed auth, no hardcoded secrets)

## Testing

<!-- What was actually run to verify this — automated tests (apps/api Jest, or a new apps/web
test per docs/TESTING.md) and/or manual verification (which diagnostic route under
app/api/diag/*, which page, which command). apps/web has no test runner yet for most areas — say
so plainly rather than implying coverage that doesn't exist. -->

- `pnpm lint`: <!-- pass/fail -->
- `turbo check-types`: <!-- pass/fail -->
- `turbo build`: <!-- pass/fail -->
- `pnpm --filter api test` (if apps/api touched): <!-- pass/fail/n-a -->
- Manual verification: <!-- describe, or "none possible without a live FusionSolar connection" -->

## Deployment impact

<!-- Does this affect the Vercel deployment for apps/web (new env var, new region-pinned route,
change to app/api/internal/* cron-style endpoints)? Does it change anything CI-relevant
(.github/workflows/ci.yml)? apps/api has no deployment target — say "N/A (apps/api)" if that's
what this touches. -->

## Checklist

- [ ] Follows `docs/CODING_STANDARDS.md` (TypeScript/Prisma/Next.js/NestJS conventions used)
- [ ] No unrelated files modified
- [ ] No secrets committed (`.env*`, tokens, client secrets)
- [ ] Documentation updated where necessary (`CLAUDE.md`, `docs/CODING_STANDARDS.md`,
      `docs/ARCHITECT_DECISIONS.md`, `docs/BACKLOG.md`/`docs/ROADMAP.md`) or explicitly not needed
- [ ] Commit message(s) follow `type(scope): summary` (`docs/DEVELOPMENT_WORKFLOW.md`)
