# Project Context

Voltessa from a product perspective. Engineering docs (`CLAUDE.md`, `docs/CODING_STANDARDS.md`,
`docs/DEVELOPMENT_WORKFLOW.md`) describe *how* the code is built; this document describes *why the
product exists* and *what it is not*, so implementation decisions can be checked against intent.
Source material: `docs/VISION.md`, `docs/CLIENT_REQUIREMENTS.md`, `docs/ROADMAP.md`,
`docs/BACKLOG.md`.

## Voltessa is not a monitoring dashboard

This has to be said plainly because it's the single easiest thing to get wrong when building a
feature: **Voltessa does not exist to show plant owners charts.** Manufacturers already provide
monitoring (Huawei FusionSolar's own portal, for instance). A dashboard that displays production
numbers back to the owner, on its own, is not the product — it's a side effect of the product.

Voltessa is an **autonomous renewable operations platform**. It doesn't just observe a plant's
data; it makes decisions and takes action on the owner's behalf — stopping and resuming grid
export in response to market prices today, with battery arbitrage, forecasting, and broader market
participation on the roadmap. The distinction matters for every feature decision: if a proposed
feature only helps someone *look at* data, ask whether it's actually in scope; if it helps Voltessa
(the operator, human or AI) *act* on the plant more effectively, it is.

## Mission

Maximize the performance and profitability of renewable energy assets through intelligent
operations.

## Vision

Become the operating system for renewable energy operations — the operational layer that sits
above every renewable asset, not another inverter portal and not another monitoring platform.
Long-term, this means autonomous optimization, battery arbitrage, predictive maintenance,
production forecasting, market participation, and portfolio-level financial optimization — see
`docs/VISION.md` for the full principle set (Operations over Monitoring, Revenue over Data, AI
First, Human Always in Control, Multi-vendor by Design, Cloud First, Built for Scale).

Two of those principles have direct, concrete engineering consequences already visible in the
codebase, and should shape how you build:

- **Human Always in Control.** AI assists and automates, but every automated action must remain
  explainable and traceable. This is why the automation domain design (ADR-001,
  `docs/ARCHITECT_DECISIONS.md`) keeps decision logic (`DecisionService`) and command execution
  (`PlantDriver`) as separate, inspectable steps rather than one opaque "do the right thing"
  function, and why `AutomationService.evaluate()` returns the full reasoning (`market`, `price`,
  `threshold`, `command`, `reason`) alongside the action taken.
- **Multi-vendor by Design.** Hardware should never define the platform. This is why automation
  logic depends on the `PlantDriver` interface rather than a concrete Huawei/KACO/SMA
  implementation — see ADR-001 and `docs/CODING_STANDARDS.md`.

## Target customers

Two distinct user roles, per `docs/VISION.md`:

- **Asset Owner** — wants answers, not operational work: production, profitability, reports,
  transparency, confidence. They should not need to operate the plant themselves.
- **Voltessa Operator** — manages the portfolio day to day: live monitoring, AI recommendations,
  fleet overview, remote control, automation, market intelligence. The operator is the *primary*
  user of Voltessa — the product is built around making the operator effective at running many
  plants, not around a self-service owner dashboard.

A third "user," continuously evaluating market prices, weather, production, batteries, forecasts,
and operational constraints on behalf of the operator, is the AI/automation layer itself.

## MVP scope

The concrete, currently-committed scope is the first customer's requirements
(`docs/CLIENT_REQUIREMENTS.md`), narrower than the long-term vision:

- Platform: Huawei FusionSolar only.
- Goal: avoid selling electricity into the grid at unfavorable market prices.
- Requirements: configurable stop-export threshold, configurable resume-export threshold, no
  duplicate commands sent to the plant, a minimum interval between commands, a scheduler that
  evaluates conditions on an ongoing basis, an event log of what was decided and done, remote
  management (no on-site hardware required).

`docs/VISION.md`'s broader MVP framing (multi-vendor monitoring, fleet overview, revenue dashboard,
market prices, AI recommendations, remote inverter control, automated reporting) is the target
*shape* of the first public version; `docs/CLIENT_REQUIREMENTS.md` is the concrete slice actually
being built for the first real customer right now. When scoping a task, `CLIENT_REQUIREMENTS.md` +
`docs/BACKLOG.md`/`docs/ROADMAP.md` (sprint-level status) are the sources of truth for "is this in
scope today," not the long-term vision document.

## Future vision

Beyond the single-plant, single-vendor MVP, `docs/VISION.md` describes where the product is
headed — useful context for not accidentally building something that has to be thrown away at the
next stage:

- **Multi-plant, multi-vendor fleets** — KACO, Sungrow, SMA, Fronius, SolarEdge, generic Modbus
  devices, in addition to Huawei. This is *why* vendor abstraction (`PlantDriver`) exists from day
  one even though only a mock/Huawei path is implemented today — don't build vendor-specific logic
  in a place a second vendor couldn't reuse.
- **Battery arbitrage and optimization** — already the top item in `docs/BACKLOG.md`'s "High
  Priority" list, alongside forecast-based decisions and dynamic thresholds.
- **Autonomous optimization and market participation** — the decision layer evolving from
  fixed thresholds toward AI-driven, forecast-aware, market-participating strategies. Every
  recommendation the AI layer makes must include reasoning; every automated action must be
  traceable — this is a hard product requirement, not an aspiration, and should inform how new
  decision/automation code surfaces its own reasoning.
- **Scale** — from one rooftop installation to thousands of utility-scale assets, with
  multi-tenancy (`Organization` in `prisma/schema.prisma`) mandatory from the start.

## Success metric

Per `docs/VISION.md`: not dashboards, charts, or feature count. Success is increased profitability,
reduced downtime, faster operational decisions, higher automation rate, and customer trust. Before
proposing or implementing a feature, the guiding question from `docs/VISION.md` applies: *"Does
this help Voltessa operate renewable assets more efficiently? If the answer is no, it is probably
not a priority."*
