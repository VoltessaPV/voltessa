# AI Task Template

A reusable template for scoping an AI implementation task on Voltessa before writing code. Use it
for anything beyond a trivial one-line fix — it's step 6 ("produce a short implementation plan") of
the "AI Operating Principles" workflow in `CLAUDE.md`. Copy the template below and fill it in; the
worked example after it shows the expected level of detail.

## Template

```markdown
### Goal

One or two sentences: what capability exists after this task that doesn't exist now. State it in
Voltessa's domain terms (plant, organization, export mode, threshold, FusionSolar connection,
role/permission), not generic CRUD terms.

### Context

- Which part of the system does this touch — `apps/api` (architecture prototype) or `apps/web`
  (the real product)? See CLAUDE.md's repo layout if unsure.
- What already exists that's relevant (existing helper, pattern, model, permission bucket)? Note
  it here so it gets reused, not duplicated.
- Which docs were read: CLAUDE.md, docs/AI_PLAYBOOK.md, docs/CODING_STANDARDS.md, and any other
  doc specific to the area (docs/ARCHITECT_DECISIONS.md, docs/PROJECT_CONTEXT.md, docs/TESTING.md).

### Acceptance Criteria

Concrete, checkable statements — not "works correctly." E.g.:
- [ ] ...
- [ ] ...

### Constraints

- Multi-tenancy: does this need to be scoped by `organizationId`? How?
- RBAC: which `Permissions.can*` bucket gates this, if any?
- Vendor abstraction: does this need to stay vendor-neutral (go through `PlantDriver` / the
  FusionSolar gateway pattern), or is it legitimately vendor-specific?
- Any explicit non-goals — what this task deliberately does NOT do.

### Files likely affected

List specific paths, not directories, where you can predict them. Flag any file outside the
obvious area that might also need a change (e.g. `turbo.json` globalEnv for a new env var,
`lib/routes.ts` for a new top-level route, `CLAUDE.md` if repo-wide facts change).

### Risks

- Does this touch automation/decision logic or the FusionSolar OAuth/gateway integration? (See
  docs/AI_PLAYBOOK.md — real financial/operational impact, extra care required.)
- Does this touch a Prisma model used elsewhere — could a schema change break another feature?
- Is there an existing inconsistency nearby (see CLAUDE.md's "Known gaps") that's tempting to fix
  as a drive-by? Name it and leave it alone unless it's explicitly in scope.

### Validation Steps

- [ ] `pnpm lint`
- [ ] `turbo check-types`
- [ ] `turbo build`
- [ ] `pnpm --filter api test` (if `apps/api` touched)
- [ ] Manual verification method (which diagnostic route, which page, which command) — see
      docs/TESTING.md if no automated test covers this path yet.

### Definition of Done

- [ ] Acceptance criteria above are all satisfied.
- [ ] `pnpm lint` / `turbo check-types` / `turbo build` all pass.
- [ ] No TypeScript errors remain.
- [ ] No unrelated files were modified.
- [ ] Documentation updated where necessary (CLAUDE.md, docs/CODING_STANDARDS.md,
      docs/ARCHITECT_DECISIONS.md, docs/BACKLOG.md/docs/ROADMAP.md) — or explicitly noted as not
      needed.
```

## Worked example

```markdown
### Goal

Add a `minCommandIntervalSeconds` enforcement check to `AutomationService.evaluate()` so a command
is never sent to a plant more often than `plant.automation.minCommandIntervalSeconds` allows — this
is an explicit requirement in docs/CLIENT_REQUIREMENTS.md that isn't implemented yet.

### Context

- Touches `apps/api` (`AutomationService`, the reference implementation) — not `apps/web`, which
  has no automation-execution logic yet.
- `Plant.automation.minCommandIntervalSeconds` already exists on the `Plant` type
  (`apps/api/src/plant/plant.types.ts`) and is set on the demo plant
  (`apps/api/src/plant/plant.service.ts`), but nothing reads it yet.
- `PlantService.saveCommand()` already records `plant.state.lastCommand.executedAt` — the data
  needed to enforce the interval already exists.
- Read: CLAUDE.md, docs/AI_PLAYBOOK.md ("financial impact" guidance), docs/CODING_STANDARDS.md
  (NestJS conventions), docs/TESTING.md (priority list already flags
  `AutomationService.shouldSendCommand()` as a top testing priority).

### Acceptance Criteria

- [ ] `AutomationService.evaluate()` does not call `driver.execute()` (and does not call
      `plantService.saveCommand()`) if less than `minCommandIntervalSeconds` has elapsed since
      `plant.state.lastCommand.executedAt`, even if `shouldSendCommand()` would otherwise return
      true.
- [ ] The returned result object reflects that the command was suppressed for interval reasons
      (distinct from "suppressed because mode already matches").

### Constraints

- No multi-tenancy concern — `apps/api`'s `PlantService` is a single in-memory demo plant, not
  Prisma-backed.
- No RBAC concern — this is internal decision logic, not a user-facing action.
- Must stay vendor-neutral: the interval check belongs in `AutomationService`, not in a driver.

### Files likely affected

- `apps/api/src/automation/automation.service.ts`
- `apps/api/src/automation/automation.service.spec.ts` (new)

### Risks

- This is exactly the kind of decision logic docs/AI_PLAYBOOK.md flags as high-stakes — get the
  comparison direction and units (seconds vs. milliseconds) right, and cover the boundary case in
  a test.
- Don't also "fix" the orphaned `apps/api/src/market.controller.ts` duplicate noticed nearby —
  out of scope, flag it instead.

### Validation Steps

- [ ] `pnpm lint` (from apps/api)
- [ ] `turbo check-types`
- [ ] `turbo build`
- [ ] `pnpm --filter api test` — new spec covers: no prior command (always allowed), command just
      inside the interval (suppressed), command just outside the interval (allowed).

### Definition of Done

- [ ] All acceptance criteria met and covered by the new spec.
- [ ] Lint/type-check/build clean.
- [ ] Only `automation.service.ts` and its new spec file changed.
- [ ] docs/ROADMAP.md's Sprint 1 "Предстои" (upcoming) list checked — if this closes a tracked
      item, mark it done.
```
