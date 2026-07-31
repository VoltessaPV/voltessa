# Production Validation Checklist

The official production acceptance checklist for Voltessa: the complete path from an approved
change to a verified production state. `docs/FEATURE_CHECKLIST.md` covers scoping a feature from
idea through commit; `docs/DEVELOPMENT_WORKFLOW.md` covers local setup, branching, and commit
conventions. This document picks up where both stop — commit onward — and is the one to follow for
every deployment, not just large or risky ones.

Provenance: this checklist formalizes the workflow actually exercised end-to-end during the GDPR +
Cookie Consent Platform milestone, including a real production incident (a missing migration) that
the workflow below is written to prevent from recurring. It is a standing procedure, not a record of
that milestone — keep it current as tooling changes; don't append milestone-specific history to it.

A task is not complete when code is merged. It is complete only when Section 6 is satisfied.

## 1. Development

- [ ] Implementation follows existing patterns for the area touched — see
      `docs/FEATURE_CHECKLIST.md` sections 1–7 for scoping, data model, auth, and integration
      conventions; don't re-derive them here.
- [ ] **Architecture review, when applicable**: for anything with real financial, legal, security,
      or personal-data impact (automation/decision logic, the FusionSolar integration, auth,
      anything handling personal data), produce a short design proposal and get explicit approval
      *before* writing code — don't treat this as optional because "it's just a checklist item."
- [ ] Lint, typecheck, and build, run **sequentially**, not concatenated into one `turbo` invocation:

  ```sh
  npx turbo check-types
  npx turbo lint
  npx turbo build
  ```

  Running `check-types` and `build` in the same `turbo` call can race on `.next/types` (both
  regenerate it) and produce a spurious `TS6053` failure unrelated to your code — if you see that
  specific error, re-run the failing task alone before concluding something is actually broken.
- [ ] Local validation is clean for every workspace touched, not just the one you changed most.

## 2. Pull Request

- [ ] Commit message(s) follow `docs/DEVELOPMENT_WORKFLOW.md`'s `type(scope): summary` convention.
- [ ] Push the branch, then create the PR with a real Summary + Test plan body:

  ```sh
  git push -u origin <branch>
  gh pr create --title "..." --body "..."
  ```
- [ ] **CI verification**: poll until every check reports `pass`, never merge on `pending` or
      `fail`:

  ```sh
  gh pr checks <number>
  ```
- [ ] Review the diff yourself before merging: no unrelated files, no accidental `.env*`/secret
      inclusion, no drive-by refactors bundled into the change.
- [ ] Merge, matching this repo's existing history (`git log` shows merge commits, not squashes):

  ```sh
  gh pr merge <number> --merge --delete-branch
  ```

## 3. Preview Deployment

- [ ] Confirm the PR's Vercel preview check passed (`gh pr checks` reporting `Vercel` as `pass`).
- [ ] **Runtime verification, not just build success** — a preview can build cleanly and still 500 at
      runtime (an uncaught exception only surfaces on an actual request). Preview URLs sit behind
      Vercel's deployment protection; get a working URL first:

  `mcp__plugin_vercel_vercel__get_access_to_vercel_url` (or equivalent) to mint a shareable
  bypass URL — don't assume a preview URL is directly reachable.
- [ ] **Page rendering**: actually load every new/changed page on the preview and confirm it
      renders — a route can build successfully and still throw at request time for a reason build
      never exercises (a missing Provider, a runtime-only dependency, etc.).
- [ ] **Playwright smoke tests, when applicable**: for anything interactive (a form, a banner, a
      modal, a multi-step flow), script it in a real headless browser rather than reasoning about it
      from the diff. Playwright is already installed under `automation/` (`automation/node_modules`)
      — run scripts from that directory so they resolve it, rather than adding Playwright as a new
      dependency elsewhere. Write these as throwaway scripts (see Cleanup, Section 5) — never commit
      them.
- [ ] If a runtime error is found on preview: root-cause it (see Section 7 — never patch around it),
      fix it, push again, and re-verify before merging. This exact step caught a real bug in this
      milestone (`useCTA must be used within a CTAProvider` on every new legal page) before it ever
      reached production.

## 4. Production Deployment

- [ ] Merging to `main` auto-deploys via Vercel's Git integration — no manual deploy step (see
      `docs/DEVELOPMENT_WORKFLOW.md`'s Deployment workflow section for the region-pinning and
      scheduling context).
- [ ] **Deployment health**: confirm the production deployment's state is `READY` and its `target`
      is `"production"` (Vercel MCP `list_deployments` / `get_deployment`, or the Vercel dashboard).
- [ ] **Production commit verification**: confirm the deployment's commit SHA matches
      `git log --oneline -1` on `main` — don't assume the merge deployed; verify it.
- [ ] **Database migrations, when applicable**: state explicitly whether this change used
      `prisma db push` or a generated migration (`docs/AI_PLAYBOOK.md`'s Prisma section). **Merging
      code does not apply a pending migration** — this is not automatic in this repo (no
      `migrate deploy` step in the build), and forgetting it is exactly what caused a real production
      incident in this milestone (a feature shipped and built successfully while its own database
      table didn't exist yet). If a migration is pending, apply it explicitly:

  ```sh
  cd apps/web
  npx prisma migrate status     # confirm what's pending, before
  npx prisma migrate deploy     # apply
  npx prisma migrate status     # confirm "up to date", after
  ```
- [ ] **Migration verification**: `prisma migrate status` reports the schema up to date, and any
      new table/column is actually queryable (a one-off read-only script using the existing Prisma
      client is sufficient — see Section 5's Database checks).

## 5. Production Smoke Test

Run against the real production domain, not the preview — a preview can be green while production
itself is still on an older commit or missing a migration.

**General**
- [ ] Homepage loads.
- [ ] Core navigation works (header/footer links, primary nav).
- [ ] Authentication still gates protected routes correctly.
- [ ] Critical user flows for the area touched work end-to-end.

**Server**
- [ ] Runtime logs checked for new errors since the deploy, not just absence of complaints
      (`mcp__plugin_vercel_vercel__get_runtime_errors` / `get_runtime_logs`, scoped to the new
      deployment ID and a window starting at the deploy time).
- [ ] No new Prisma errors.
- [ ] No failed network requests tied to the feature.
- [ ] No new hydration errors (`Hydration failed...` in the browser console/page errors).
- [ ] No new JavaScript errors.

**Feature-specific validation**
- [ ] Every newly introduced feature exercised end-to-end in a real browser (Playwright against
      production, mirroring the preview scripts from Section 3) — not inferred from a passing build.
- [ ] Related/adjacent features re-checked for regressions, not just the new surface — a shared
      component (a layout, a provider, a shared hook) can break something you didn't touch directly.

**Database**
- [ ] Expected records were actually written (query, don't assume) — e.g. a new log/audit table has
      rows matching the actions just performed.
- [ ] Expected records were updated where the feature updates existing rows.
- [ ] Expected records were removed where the feature deletes — **and only test data you yourself
      created during this verification**, identified precisely (by ID or a narrow, verifiably-safe
      filter such as a timestamp window matching exactly your own test run), never a blanket delete.
      Before deleting anything, check whether rows in that window could be real user activity — they
      might be.

**Security & Privacy**
- [ ] Authentication unaffected — protected routes still redirect/gate correctly.
- [ ] Authorization/permission checks unaffected — role-gated actions still enforce
      `Permissions.can*`.
- [ ] Cookies set with correct attributes (`httpOnly`, `secure` in production, `sameSite`) — verify,
      don't assume the code you wrote does what you think.
- [ ] Consent (when applicable): still requestable, withdrawable, and persisted correctly; version
      still recorded.

**Cleanup**
- [ ] Every temporary script removed (the repo's own "Diagnostic Scripts" convention in `CLAUDE.md`
      — create, execute, delete before finishing).
- [ ] Every temporary diagnostic (added logging, debug routes) removed or was never committed.
- [ ] Every temporary test record you created during verification removed — surgically, by exact
      ID, never a broad delete.
- [ ] Production data belonging to real users or existing records left completely untouched.

## 6. Completion Criteria

A task is **not** complete merely because it has been merged. A production milestone is complete
only when:

- production deployment succeeded;
- production is serving the expected commit;
- all production smoke tests pass;
- no new runtime errors exist;
- no regressions are observed;
- temporary tooling has been removed;
- production data has been left clean.

## 7. Engineering Principles

- **Production-first validation** — a passing build and a passing local test are necessary, not
  sufficient; the only real confirmation that a feature works is observing it work in production (or
  at minimum, on a preview deployment hitting the same database).
- **Root-cause analysis before fixing** — when production breaks, find the actual cause (read the
  real runtime error, don't guess) before writing a fix; a fix aimed at the wrong cause either
  doesn't work or hides the real problem.
- **Never hide runtime errors** — don't wrap something in a broad try/catch just to make a symptom
  go away; if a secondary concern (logging, analytics) shouldn't be allowed to break a primary user
  action, that's a deliberate resiliency decision to state explicitly, not a place to swallow
  unrelated failures silently.
- **Verify with real browser interactions when appropriate** — curl confirms a page returns 200; it
  cannot confirm a client interaction works, that no hydration mismatch occurs, or that a Server
  Action actually completes without error. Use a real (even headless) browser for anything
  interactive.
- **Prefer Playwright over manual repetition for regression testing** — a scripted check that
  navigates, clicks, and asserts is faster to re-run and more reliable than repeating manual clicks,
  especially across preview and production.
- **Remove temporary tooling after use** — diagnostic scripts, one-off queries, and debug logging are
  disposable by design; leaving them in the repo or running in production is itself a regression.
- **Never modify or delete production user data** — the only rows ever removed during verification
  are ones you can prove you created yourself in that same verification pass.
- **Clean up only test artifacts you created yourself** — if you can't attribute a record to your own
  action with confidence, leave it alone; it may be real user activity.
- **Do not declare success until production has been verified** — a merged PR, a green CI run, and a
  successful build are milestones on the way to done, not the definition of done.
