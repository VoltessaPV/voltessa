# CLAUDE_SESSION.md

Permanent onboarding guide for every Claude session working on Voltessa. A new session begins
with "Read CLAUDE_SESSION.md and follow it." This document describes a **procedure** — how to
reconstruct the current state of the project from the repository itself — not the state itself.
The state changes constantly; the procedure for discovering it should not. Do not add
dates, timestamps, milestone names, incident details, or any other fact that will go stale — that
information belongs in `CLAUDE.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md`, or the repository's own
history, all of which this document tells you to go read.

This document governs *process*. `CLAUDE.md` remains the canonical source for Voltessa's
architecture, commands, conventions, and standing rules (Working Rules, Never, Autonomous
Milestone Execution). Read `CLAUDE.md` as part of onboarding (see below) — do not treat this file
as a replacement for it, and do not duplicate its content here.

## Sources of truth, in order

Implementation is always the primary source of truth. Documentation describes intent at the time
it was written and may have drifted from what the code actually does. When you need to know
whether something exists, works, or is deployed, inspect in this order:

1. **Current implementation** — the actual code, schema, and configuration in the repository.
2. **Git history** (`git log`, `git log -p`, `git blame`) — why the current implementation looks
   the way it does, and what has already been tried, fixed, or reverted.
3. **`CLAUDE.md`** — architecture, repo layout, commands, conventions, standing rules.
4. **`README.md`**
5. **`docs/`** (excluding ADRs and roadmap/backlog, covered separately below)
6. **ADRs** (`docs/ARCHITECT_DECISIONS.md`, `docs/DECISIONS/*`)
7. **`docs/ROADMAP.md`**
8. **`docs/BACKLOG.md`**

If a document and the implementation disagree, do not silently trust either one and do not average
them into a guess:

- Identify every discrepancy you find, specifically — not "these seem inconsistent" but which
  claim and which code, quoted or cited.
- Explain the discrepancy: is the doc stale, was the implementation changed without updating the
  doc, or does the doc describe an intent that was never built?
- Treat the implementation as authoritative for what the system currently *does*. Report the
  discrepancy to the user rather than fixing the documentation yourself as a drive-by, unless the
  task at hand is specifically to update that documentation.

## Onboarding procedure

No implementation may begin before onboarding is complete. Before writing any code, proposing a
plan, or making any change, reconstruct your own understanding of the project rather than relying
on memory of a previous session (a previous session's understanding may itself be stale, and you
have no way to verify it without doing this work again). Work through the sources of truth above
to understand:

- overall system architecture and repo layout;
- production architecture (what runs where, and why);
- deployment architecture (how a change reaches production);
- the Automation Service and its scope/boundaries;
- the FusionSolar integration and its gateway boundary;
- scheduler architecture (what runs on a schedule, and how);
- notification architecture (what triggers a notification, and to whom);
- the database schema and its multi-tenancy shape;
- the current milestone in progress;
- the next planned milestone.

Alongside reading, inspect the repository's actual state directly rather than assuming it matches
whatever was true in a previous session:

- `git status` — uncommitted or untracked changes;
- current branch;
- how far ahead of/behind `origin` the current branch is;
- the latest commits (`git log --oneline -n 20` or similar) — what actually landed most recently,
  not what a stale summary claims landed;
- general repository cleanliness (stray files, leftover diagnostic scripts, unresolved merge
  artifacts).

Do not treat any of the above as already known from a prior conversation. Re-derive it every
session.

## Engineering principles

These are permanent and apply regardless of task size:

- Never assume. Never guess.
- Verify implementation before making a technical claim.
- Cite evidence — a file/line, a commit, a log line, or an observed deployment/runtime check —
  whenever stating that something exists, works, or is deployed. A claim without evidence is a
  guess, not a finding.
- Memory is not evidence — not your own recollection, and not a prior session's summary. If you
  cannot point to implementation, a commit, a log, or an observed runtime/production behavior,
  treat the claim as unverified and say so.
- Before introducing any new implementation, first determine whether an existing pattern already
  solves the problem. Prefer, in order: reuse what exists, extend what exists, introduce something
  new only when neither is possible. Consistency is preferred over novelty.
- Move code instead of duplicating it.
- Keep the repository clean: remove dead code you were asked to touch, don't leave placeholder or
  half-finished implementations, don't leave hidden assumptions unstated.
- Keep commits focused on one change; keep unrelated changes — including drive-by fixes or
  formatting — out of them.
- If you notice unrelated pre-existing issues while working, report them to the user instead of
  fixing them as a drive-by, unless asked to fix them.

## Facts, evidence, and hypotheses

Keep these categories distinct in anything you report, and label which one you're offering
whenever it isn't obvious from context:

- **Observation** — something directly seen: a log line, a screenshot, a file's actual contents.
- **Evidence** — an observation used to support a specific claim.
- **Assumption** — something taken as true without checking it. State it as an assumption; never
  imply it was verified.
- **Hypothesis** — a possible explanation that evidence has not yet confirmed.
- **Conclusion** — a claim backed by enough evidence to state with confidence.

A hypothesis may be reported, but never presented as a conclusion. If the evidence you have only
supports a hypothesis, say so explicitly and state what additional evidence would confirm or rule
it out, rather than rounding it up to a root cause.

## Production safety

Assume any production system this repository touches is live, not a sandbox: real customer data,
real automated control of physical equipment, real financial consequences. This applies by
default, not only in areas already known to be sensitive.

- Default to read-only investigation — reading logs, screenshots, code, and stored state — over
  any action that changes production state.
- Never execute a real production operation (a control command, a write, a state change) unless
  explicitly requested.
- Diagnosing a problem must never itself become the cause of a new one. If a diagnostic step would
  change production or plant state, say so and confirm before doing it — don't treat it as
  routine.

## Incident investigation

Investigation always precedes implementation. For every production incident:

1. Gather evidence — logs, error output, screenshots, traces, database/state, anything
   observable, not recollection. Prefer read-only access wherever possible (see Production
   safety above).
2. Inspect the implementation the evidence points to.
3. Compare against previous occurrences of the same or a similar failure (git history, prior
   incident fixes, prior evidence if it still exists).
4. Determine root cause from the evidence gathered — not from the most plausible-sounding guess.
   Label each finding as an observation, evidence, a hypothesis, or a conclusion (see Facts,
   evidence, and hypotheses above); never present a hypothesis as a confirmed root cause.
5. State a confidence level and what would raise or lower it.
6. Stop.

Do not implement or propose a fix until the root cause has been demonstrated with evidence. A
task that asks for investigation only is complete when the root cause (or the explicit limits of
what the evidence can show) has been reported — not when a fix has also been applied.

## Development workflow

For implementation tasks, once onboarding is complete:

1. Understand the task in the project's own domain terms, not generic CRUD terms.
2. Inspect the existing implementation for the area being touched — search before assuming
   something doesn't already exist.
3. Apply the reuse/extend/new preference (see Engineering principles) to the area being touched.
4. Implement, following the codebase's established conventions.
5. Validate (see below).
6. Commit, following the project's commit conventions.
7. Deploy, following the project's deployment process.
8. Verify production behavior after deployment.

## Validation

Before every commit:

- lint
- typecheck
- build

After every deployment:

- verify the deployment itself succeeded;
- verify the runtime is healthy;
- verify the actual production behavior the change was meant to affect, where that's observable.

A failing validation step blocks the task; fix it or stop and explain why — do not report work as
done with a known-failing check.

## Expected onboarding report

After completing onboarding, and before any development work begins, produce a report containing
only:

**Project Status**

- completed milestones
- current milestone
- next planned milestone
- outstanding issues
- known production issues
- repository status
- working tree status
- current branch
- ahead/behind origin
- recent deployments
- questions, if any

Then stop and wait for user instructions. Do not modify code during onboarding, and do not pad the
report with narrative, recommendations, or a proposed plan — those come after the user responds.

## Maintainability

This document should stay stable over time; it is reviewed for accuracy, not rewritten per
milestone. It describes *how* to discover the current project state, never the state itself. When
extending it, prefer adding to the procedure (a new source of truth, a new category to inspect, a
new permanent principle) over recording a fact that will need updating again later — facts belong
in `CLAUDE.md` or the docs it points to.
