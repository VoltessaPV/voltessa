# AI Playbook

How an AI coding agent (Claude Code or otherwise) should operate specifically in the Voltessa
repo. This is not a generic "AI best practices" document — every rule below exists because of
something true about this codebase's current state. Read `CLAUDE.md` first: it is the canonical
source for this repo's facts and rules — architecture, commands, env vars, Engineering Principles,
Working Rules, Never, and Autonomous Milestone Execution. This playbook does not repeat those;
it adds the specific, concrete guardrails and historical context CLAUDE.md doesn't have room for.

## The stakes are real

See CLAUDE.md's "This is a live system, not a sandbox" callout. Concretely, that means: prefer
smaller, explicit diffs when touching `apps/api/src/decision/*`, `apps/api/src/automation/*`, or
`apps/web/lib/fusionsolar/*`; explain the reasoning for any threshold/comparison logic change in
the commit message; and flag the change clearly to the user rather than bundling it into an
unrelated commit.

## Two implementations, one is not "broken"

See CLAUDE.md's Repo Layout for why `apps/api` and `apps/web` both contain automation/plant/
FusionSolar-shaped code but aren't the same system. Concretely, do not:

- "Fix" `apps/web` by wiring it to call `apps/api`, or vice versa, unless explicitly asked.
- Assume `apps/api`'s in-memory `PlantService` (`apps/api/src/plant/plant.service.ts`, one
  hardcoded `Demo Plant`) reflects real data — it doesn't; real plant data is in
  `apps/web/prisma/schema.prisma`.
- Treat the orphaned `apps/api/src/market.controller.ts` duplicate (see CLAUDE.md's Known Gaps)
  as something to silently clean up mid-task — mention it, don't fix it as a drive-by.

## The empty `domains/`/`services/` stubs

See CLAUDE.md's "apps/web internal structure" for why these are deliberate, not missing code. The
one nuance CLAUDE.md doesn't cover: if a task genuinely needs logic that conceptually belongs in
one of these domains, ask whether to place it there (continuing the migration) or alongside the
existing `lib/fusionsolar` style (current precedent) — don't decide unilaterally, the two styles
have different implications for the rest of the codebase.

## Secrets and credentials

See CLAUDE.md's Configuration section for the full env var list. Never read, print, log, or commit
the contents of `apps/web/.env` or `apps/web/.env.local` — if you need to know whether a variable
is configured, check for its **name**, not its value. Before any commit, check `git status`/`git
diff` for accidental inclusion of `.env*` files — they're gitignored, but don't assume that
protects you if someone force-adds one.

## Prisma migration strategy

See CLAUDE.md's Commands section for the current state (`db push` + one committed migration).
When a task requires a schema change, state explicitly whether you're using `db push` or
generating a migration, and prefer matching whatever the most recent schema change in `git log --
apps/web/prisma/schema.prisma` did, unless the user says otherwise.

## FusionSolar integration code has real reasons behind it

CLAUDE.md's Engineering Principles already names the concrete examples (the retry error-code
allow-list, `timingSafeEqual`, `fra1` region pinning) and why each exists. Before simplifying any
of them away, run `git log -p` on the file first — the long `debug(fusionsolar): ...` /
`fix(fusionsolar): ...` commit sequence is the record of getting each one right against the real
gateway, and "simplifying" one back out is how a real, already-fixed bug gets reintroduced.

## Autonomous milestone execution

See CLAUDE.md's "Autonomous Milestone Execution" section — that's the canonical rule. One
recurring, environment-specific instance of "credentials are missing and unobtainable" worth
knowing in advance: this sandbox redacts real secret values used by local dev, so FusionSolar-
gateway-dependent code can't be exercised locally. The established pattern (see the FusionSolar
diagnostic milestones in `git log`) is to push and verify against production instead, or ask the
user to run one command with the real secret and paste back the result — not to treat it as a
blocker requiring a full stop.

## Scope discipline

See CLAUDE.md's "Prefer simple solutions" (Working Rules) and "Simplicity over cleverness"
(Engineering Principles). Concretely for this repo: don't add abstraction layers "for the future"
beyond what's already scaffolded (`domains/`, `services/`), don't introduce a new state-management/
data-fetching library when a Server Component + Prisma call already does the job, and don't
refactor unrelated code while fixing something else — flag it instead and let the user decide.
