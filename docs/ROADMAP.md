# Sprint 1

## Завършено

- [x] Market Service
- [x] Decision Service
- [x] Plant Service
- [x] Automation Service
- [x] Mock Driver

## Предстои

- [ ] FusionSolar Client
- [ ] Login
- [ ] Read Export Mode
- [ ] Stop Export
- [ ] Resume Export
- [ ] Scheduler
- [ ] Event Log

---

# Sprint 1A — Security & Authorization Foundation

## Completed

- Centralized current-user / organization / role lookup into `lib/auth/session.ts`
  (`getCurrentUser`, `requireCurrentUser`, `requireOnboardedUser`, `requirePermission`), replacing
  the duplicated `auth()` + Prisma-lookup pattern across seven `(platform)` pages/actions
- Enforced the existing `Permissions.can*` RBAC model (previously defined but unused) on the plant
  read and write surfaces (`canViewPlants`, `canManagePlants`)
- Represented authorization failure with Next.js's own `forbidden()`, alongside the existing
  `redirect()` (auth/onboarding) and `notFound()` (missing plant) conventions
- See ADR-006 in `docs/ARCHITECT_DECISIONS.md` for the full decision record

---

# Sprint 1B — Authorization Follow-through

## Planned

- Extend the shared session/authorization pattern to the FusionSolar route handlers
  (`app/api/auth/fusionsolar/*`, `app/api/diag/*`), which still duplicate the pre-Sprint-1A pattern
  because `next/navigation`'s `redirect()`/`forbidden()` don't work in Route Handlers
- Give the `forbidden()` (403) state a custom `forbidden.tsx` instead of relying on Next's default
  fallback
- Decide whether `settings/page.tsx` needs a `Permissions` bucket (none of the existing four map
  cleanly to "manage integrations" today)
- Retire the unused `domains/auth/types.ts` `SessionUser` type now that `CurrentUser` in
  `lib/auth/session.ts` supersedes it
- Fix the pre-existing `packages/ui` lint/type-check breakage (`../lib/utils` import, empty-interface
  warnings) so `pnpm lint` / `turbo check-types` can pass repo-wide again

---

# Sprint 2

- PostgreSQL
- Prisma
- React Dashboard
- Authentication

---

# Sprint 3

- Multi Plant
- KACO
- SMA
- Notifications

---

# FusionSolar Automation Service Migration

## Completed

- Extracted all Playwright/browser-automation logic for the Atlanta plant out of
  `apps/web` into an independent Automation Service (`automation/`, repo root) — a
  standalone Node process with its own systemd unit on the existing Scaleway VM.
  `apps/web` now communicates with it only over authenticated HTTP
  (`lib/automation-client.ts`); no Playwright/Chromium code or dependency remains
  anywhere in `apps/web`. See git history on `automation/` and
  `apps/web/lib/fusionsolar/browser/*` for the full incident record (VM resource
  starvation, the deterministic-navigation rewrite, nginx timeout tuning).
- Fixed a production defect where FusionSolar's post-Save "Operation succeeded"
  dialog blocked the automation's post-Save verification step
  (`dismissSaveSuccessDialog` in `automation/src/fusionSolar/navigation.ts`).
- Tuned nginx's `/automation/` proxy timeouts (`proxy_connect_timeout` 30s,
  `proxy_send_timeout`/`proxy_read_timeout`/`send_timeout` 300s) so a legitimate
  multi-dongle Zero Export/No Limit request can complete without a premature 504.
- Verified end-to-end in production: Read Status, Enable Zero Export, and Enable
  No Limit all succeed through the real Voltessa → nginx → Automation Service
  path, with clean Chromium shutdown every time.
- Shipped the first production version of `/automations`: a Market Price
  Optimization card (enable/disable + €/MWh threshold, UI + persistence only,
  backed by the existing `AutomationSettings` model) and a Battery Optimization
  informational card, replacing the old engineering console (moved unchanged to
  `/dev/huawei-api`).

---

# Market Price Optimization — Execution Engine

## Completed

- Implemented the real scheduling/execution logic behind the Market Price
  Optimization card: a ±5 EUR/MWh hysteresis band around
  `AutomationSettings.minimumExportPrice` (internal detail, never exposed in
  the UI), evaluated every 15 minutes
  (`voltessa-automation-execution.timer`), dispatching Zero Export / No Limit
  through the existing Automation Service only when a switch is actually
  decided. See ADR-013 in `docs/ARCHITECT_DECISIONS.md` for the full decision
  record.
- New `AutomationState` model (per organization) stores the last
  successfully applied mode and doubles as a per-organization DB-backed
  execution lock — the 15-minute engine never queries FusionSolar directly.
- New `AutomationEvent` model is the traceability record — created only when
  something actually happened (a switch, a failure, a reconciliation
  mismatch/sync), never for a normal no-action tick.
- A second, independent daily job (`voltessa-automation-reconciliation.timer`)
  is the one place that reads FusionSolar's real state and
  corrects Voltessa's stored record if it has drifted (e.g. a manual change
  via `/dev/huawei-api`) — mirrors the existing telemetry/market-price
  scheduler split (ADR-009) of keeping different-cadence jobs in separate
  systemd units.
- Atlanta Automation incident (05–06 Sep 2026) remediation. **PR1**: the
  execution lock is now failure-safe (a serverless kill can no longer leave
  `AutomationState.isRunning` stuck — a lock older than
  `EXECUTION_LOCK_TTL_MS` is atomically reclaimed), reconciliation has its
  own lock (a stuck execution lock can no longer suppress drift detection),
  and a reconciliation that cannot verify real FusionSolar state is recorded
  FAILED, never a misleading SUCCESS. **PR2 (ADR-022)**: the morning
  reconciliation now retries at 06:00 / 06:15 / 06:30 / 06:45 / 07:00
  Europe/Sofia (the timer's `OnCalendar`), stops the moment one attempt
  verifies, and sends exactly one Atlanta failure notification
  (`reconciliation_retry_exhausted`, deduped per org + Europe/Sofia date via
  `AutomationReconciliationAttempt`) if the 07:00 attempt still fails. Retries
  are read-only — they never issue a FusionSolar command. Not yet exercised
  by a real failing morning in production.

---

# GDPR + Cookie Consent Platform — Milestone 1

## Completed

- In-house consent management system: first-visit banner (Accept All/Reject
  All/Customize), a WCAG-oriented preferences modal, and a persistent
  "Cookie Settings" entry in the footer and authenticated Settings page.
  Consent is versioned (`CONSENT_VERSION`) and logged append-only in
  `ConsentLog` for GDPR accountability. `lib/consent/cookie-registry.ts` is
  the single source of truth for every real cookie, driving both the new
  Cookie Policy page and the preferences modal.
- Real, Voltessa-specific Privacy Policy and Terms of Service (replacing
  generic placeholders), a new Company Information page, and a documented
  data-retention schedule (`docs/legal/data-retention.md`) — all reading
  from one company/retention/sub-processor configuration under
  `lib/legal/*`. All four compliance pages and the consent UI support
  Bulgarian and English.
- Self-service account deletion now writes an `AccountDeletionRecord` (no
  personal data) in the same transaction as the delete, distinct from the
  general-purpose `AuditLog`.
- Explicitly out of scope for this milestone: GDPR self-service features
  (data export, access requests, restriction of processing) — architecture
  (`getConsent()`/`hasConsentFor()`, the registry/dictionary pattern) is
  structured so those can be added later without refactoring.

---

# Mobile Client — M0–M5, Mobile/Web Parity, Mobile Redesign

See ADR-020 in `docs/ARCHITECT_DECISIONS.md` for the full architecture record and its
"Implementation status" note; this entry is the sprint-tracking summary. `docs/BACKLOG.md` predates
all of this work and does not yet list it — see that file's own note.

## Completed

- **M0–M2**: Bearer-token session exchange extending the existing `create-session.ts`
  (ADR-020) — no new auth mechanism, the same `Session` table/lifecycle Web already uses. Real
  password sign-in, plants list, plant connection status, plant dashboard read endpoints.
- **M3**: Dashboard chart (`chartSeries`), weather widget, and market-price widget added to the
  existing dashboard Route Handler response — still a deliberate subset of the full
  `DashboardPageData`, not the complete contract.
- **M4**: Market screen (price chart, pre-computed insights, `currentExportMode`),
  `GET`/`POST /api/automation-settings` (reusing `updateMarketPriceAutomationForOrganization`
  verbatim, not duplicated), and honest BESS/Alerts placeholders matching Web's own real,
  not-yet-built state for those two areas (no fabricated data/functionality).
- **M5**: Google Sign-In via Android Credential Manager, exchanging the resulting ID token for the
  same Bearer session mint path password login already uses.
- **Mobile/Web Parity milestone**: a single shared `TimeSeriesLineChart` Compose component (no
  charting-library dependency) replacing an earlier bespoke chart, used by both Dashboard's
  energy-flow chart and Market's price chart; Dashboard terminology aligned to Web's own copy.
- **Mobile Redesign milestone** (commit `636937a`): a shared Compose design system
  (`ui/components/VoltessaComponents.kt` — `SectionHeader`/`StatusBadge`/`HeroCard`/`Metric`+
  `MetricGrid`/`DaySelectorGrid`) replacing ad hoc per-screen layout; Dashboard/Market/Automations
  redone around a "glanceable" information hierarchy (a dominant live-status/price hero, a compact
  KPI grid, area-filled/current-time-aware charts) instead of a plain vertical label/value list;
  fixed the Automations day-selector's real horizontal-clipping defect (a `LazyRow` that silently
  overflowed past the screen edge on a narrow device) with a fixed, always-fully-visible 4+3 grid;
  added two small, additive backend fields to the existing Market Route Handler (`revenue`,
  `exportRecommended`) rather than inventing/recomputing either client-side. Verified on a physical
  Samsung Galaxy S21 (Android 15) — no emulator used or planned; see ADR-020's implementation note
  for the full verification/regression summary.
- Backend deployment for the two new Market fields: commit `636937a` pushed to `origin/main`,
  Vercel production deployment confirmed `READY` and aliased to `app.voltessa.ai` as of
  2026-09-05 (verified via the Vercel deployments API against this exact commit SHA).

## Explicitly deferred (do not start without an explicit request)

- Google Play publishing — signing config, upload key, Play Console listing, store metadata,
  release track. The release Gradle variant compiles unsigned by design.
- An Android emulator/AVD testing path — physical-device testing is the current, deliberate
  priority; do not introduce an emulator requirement unless asked.
- A device/channel label on `Session` for a future "manage your signed-in devices" screen (ADR-020's
  own open question).

---

# Market Price Reliability — IBEX Fallback + Non-Blocking Recovery

See ADR-021 in `docs/ARCHITECT_DECISIONS.md` and `docs/research/entsoe-price-scheduler.md` §10 for
the full decision record and engineering report.

## Completed

- IBEX (Independent Bulgarian Energy Exchange) added as a real secondary/fallback day-ahead price
  source, used only when ENTSO-E fails/is unavailable/leaves a delivery day partial — ENTSO-E
  remains primary. Timestamp conversion (IBEX's CET-day rows mapped by position onto the same
  DST-aware boundary ENTSO-E already uses) verified exact — 96/96 intervals matched Voltessa's own
  stored ENTSO-E data for 2026-08-31 with zero difference.
- On-demand delivery-day recovery (`ensureBulgariaDeliveryDayAvailable`) moved off the
  Dashboard/Market/automation request-render critical path via `mode: "background"` (Next.js
  `after()`, mirroring the existing telemetry background-recovery pattern) — a genuinely
  missing/incomplete day no longer adds ENTSO-E/IBEX response time to a page load or an automation
  cycle.
- Automation's fail-closed guarantee (never acting on a stale/previous price if the exact settlement
  interval is missing) is unaffected and re-verified as part of this milestone.

## Not yet done

- A real, unattended production trigger of the IBEX fallback path (an actual ENTSO-E outage
  occurring after this shipped) has not been observed/confirmed live — implemented and unit-tested,
  not yet exercised by a genuine incident.
---

# Admin Reporting — 15-minute Interval CSV/XLSX Export

## Completed

- New Platform-Admin-only page `/admin/reporting` (`app/admin/reporting/*`, `lib/reporting/*`,
  `lib/admin/reporting-queries.ts`): pick a plant, a start/end datetime, and any subset of seven
  metrics — **PV Production, Total Consumption, Grid Consumption, PV Consumption, Grid Export**
  (kWh) and **Price** (EUR/MWh), **Revenue** (EUR) — then preview and download a **15-minute
  interval** report as **CSV or XLSX**. Every export ends with a mandatory `TOTAL` row.
- **Authorization**: `page.tsx` and both Server Actions (`generateReportPreview`, `exportReport` in
  `app/admin/reporting/actions.ts`) independently call `requirePlatformAdmin()` (ADR-006 /
  ADR-014 — `User.isPlatformAdmin`, `forbidden()` for non-admins, `/login` redirect for the
  unauthenticated). The plant, its `organizationId` and its `timezone` are always re-resolved from
  the database by id — never trusted from the browser. Cross-organization by design, the same
  pattern Automation Lab / Digital Twin use. `e2e/admin-routing.spec.ts` extended to cover the new
  route (unauthenticated → `/login`, never 404; locale-prefix → 308 to the unprefixed path).
- **No new data model, no new API route, no new calculation.** A pure read-only consumer of the
  canonical layers (ADR-018 lists Reporting as an intended consumer of exactly these):
  - Energy: `lib/telemetry/energy-metrics.ts` — `getPlantProductionEnergySeries` (PV Production)
    and `getPlantSettlementEnergySeries` (Grid Export / Grid Consumption from the meter's
    `activeEnergy` / `reverseActiveEnergy` counter deltas). PV Consumption = `computeConsumedFromPv`
    (production − export); Total Consumption = `production + import − export` (the `deriveEnergyFlow`
    identity). A missing interval stays blank — never coerced to `0`.
  - Price: `dbMarketPriceProvider.getPricesInRange` — persisted `MarketPrice` rows only (EUR/MWh,
    `DEFAULT_BIDDING_ZONE`), never a live ENTSO-E/IBEX call.
  - Revenue: `lib/market-price/revenue.ts`. The whole-period `TOTAL` comes straight from
    `computeExportRevenue` (`revenueEur`, plus `averagePriceEurPerMwh` for the weighted-average
    Price total). Each interval's Revenue cell uses `computeIntervalExportRevenueEur`
    (`exported kWh × price ÷ 1000`), a helper extracted from `computeExportRevenue` and now also
    called by it — one formula, two call sites. A meterless plant falls back to pricing produced
    energy, exactly like the Market page.
- **TOTAL row semantics** (documented and unit-tested in `lib/reporting/build-report.ts` /
  `build-report.test.ts`): first cell is the literal `TOTAL`, never a timestamp; PV Production /
  Grid Export / Grid Consumption / Revenue are **summed** over intervals that have a value; PV
  Consumption and Total Consumption apply their canonical identity to the period sums; **Price is an
  export-energy-weighted average** (`Σ(export·price) / Σ export`, = `RevenueSummary.averagePriceEurPerMwh`)
  and is **never summed**; a metric with no data in the period stays blank, never `0`.
- **Timezone**: `Plant.timezone` (`Europe/Sofia`) via `lib/market-price/timezone.ts`
  `zonedTimeToUtc`; the requested range is snapped to the 15-minute UTC grid (`floorToInterval`).
  DST-safe — the interval grid steps in fixed 15-minute UTC increments and rows are only relabelled
  in the plant zone, so a period crossing a DST transition has the right number of rows (92 on the
  23-hour spring-forward day, 100 on the 25-hour fall-back day — unit-tested).
- **Range limit**: `MAX_REPORT_RANGE_DAYS = 93`, enforced in every Server Action and shown in the
  UI.
- **CSV**: UTF-8 with BOM, CRLF, RFC-4180 quoting, deterministic column order (`Timestamp` + only
  the selected metrics), final `TOTAL` row, safe filename
  `voltessa-{plant-slug}-report-{start}-{end}.csv` (slugifier strips path separators, `..`,
  non-ASCII, control chars).
- **XLSX**: new pinned dependency `write-excel-file` (`apps/web`). A real two-sheet workbook —
  a **Report** sheet (frozen header, real numeric cells with energy/price/revenue number formats,
  styled `TOTAL` row) and a **Report Info** sheet (plant, period, generated-at, interval, metrics,
  currency, timezone). Not a CSV string in an `.xlsx` wrapper.
- **Tests**: `lib/reporting/{report-request,build-report,csv,xlsx}.test.ts` (added to
  `apps/web`'s `pnpm test` `tsx --test` list) — 40 cases covering request validation, invalid
  ranges/metrics/format, the metric → canonical-source mapping, missing-value preservation,
  15-minute assembly, DST boundary interval counts, all TOTAL-row semantics (energy SUM, revenue
  SUM, price weighted-average, "never SUM price", unselected metrics absent, blank-not-zero), CSV
  escaping / BOM / CRLF / TOTAL line, XLSX structure and determinism, and safe filenames. Verified
  end-to-end against the real production database's Atlanta plant before deployment.

## Notes

- No ADR — a normal read-only feature that reuses every existing canonical source; the only touch
  to shared business logic is the pure extraction of `computeIntervalExportRevenueEur` in
  `lib/market-price/revenue.ts`.
- Export endpoints are Server Actions (not `app/api/*` route handlers) to match the established
  admin pattern (Automation Lab, Digital Twin, Historical Imports).

---

# PV Impact Simulator — external load-profile self-consumption / export simulation

See ADR-023 (`docs/ARCHITECT_DECISIONS.md`) for the full decision record.

## Completed

- New Platform-Admin page **`/admin/pv-simulator`** (`app/admin/pv-simulator/*`,
  `lib/pv-simulator/*`, new pinned dependency `read-excel-file`). Upload an external customer's
  15-minute annual consumption profile (Excel, utility pivot layout — a row per day, 96
  interval-end time columns), pick a real Voltessa PV plant as the production reference, enter a
  hypothetical PV capacity (kWp) and a mode (self-consumption only / self-consumption + export),
  optionally restrict the date range, and get per-interval / hourly / monthly / whole-period
  results plus a **CSV** (15-minute detail) or a 4-sheet **XLSX** (Summary / Monthly Overview /
  Hourly Profile / 15-Minute Detail).
- **Methodology (physical energy only)**: `simulated_pv = reference_pv × (target_kWp / reference_kWp)`
  applied independently to every 15-minute interval. `reference_pv` per interval =
  `getPlantProductionEnergySeries()` (canonical Energy Engine, produced kWh — the same function the
  Reporting feature uses); `reference_kWp` = the reference plant's canonical `Plant.capacityKw`
  (Chomakovtsi = `"Чомаковци 100KW"`, 100 kWp). No irradiance model, no synthetic generation, no
  hard-coded factor. Per interval: `pv_used = min(load, sim_pv)`, `import_with_pv = load − pv_used`,
  `surplus = max(sim_pv − load, 0)`; export mode → `export = surplus`, self-consumption mode →
  `curtailed = surplus`. Invariants (no negative import/export, `pv_used ≤ load`, no export when
  export is disabled) are asserted.
- **Input / unit interpretation**: the load profile is **interval energy, kWh per 15-minute
  interval**, in the reference plant timezone (`Europe/Sofia`). Verified against the supplied file —
  its cell at (2026-05-01, interval-end 09:15) is `60`, matching the spec example
  "01.05.2026 09:15 → 60 kWh". A `unitMode` toggle (`kwh_interval` default / `kw_average` → ×0.25)
  handles a future average-power file, with a heuristic warning if a `kwh_interval` file looks
  power-shaped.
- **Totals & percentages**: monthly and whole-period `TOTAL` rows SUM the interval quantities;
  every rate (self-consumption rate, solar coverage, import-reduction %) is computed from the
  period/month totals, never by averaging per-interval or per-month rates. `TOTAL` is always the
  last row of both exports.
- **Missing data (never invent, always disclose)**: a blank consumption cell → excluded from every
  total, blank in the detail, counted. An interval whose reference plant has no telemetry
  (Chomakovtsi's `DeviceTelemetry` starts 2026-01; a profile beginning earlier has months with no
  reference production) → consumption and grid import are kept (grid import with PV = load, since
  there is no PV), production is left null and excluded from PV totals and rate denominators, and
  the summary reports the reference-PV day coverage plus **both** a whole-period and a
  covered-days-only solar-coverage / import-reduction figure. Within a covered day a null bucket
  (night / brief gap) → `0`.
- **Timezone / DST / leap year**: each interval's instant is `zonedTimeToUtc(date, startHH:startMM,
  Europe/Sofia)` (DST-exact); the profile is 96 civil slots per calendar day regardless of DST.
  Spring-forward's non-existent local hour → `dst_ambiguous` (first kept, rest excluded, counted &
  warned); the source's trailing blanks on that 23-hour day → `missing_load`. Feb 29 is a normal
  row.
- **Authorization**: `/admin/pv-simulator` page and both Server Actions
  (`runSimulationPreview`, `exportSimulation`) independently call `requirePlatformAdmin()`
  (ADR-006 / ADR-014); the reference plant, its timezone and its capacity are re-resolved from the
  database by id — never trusted from the browser. The uploaded file is parsed in memory per run
  and **never persisted** (no customer data in the repo, no DB write, no Prisma migration).
  `e2e/admin-routing.spec.ts` extended for the new route.
- **Financial / ROI**: explicitly **out of scope** for this phase. The simulator emits only
  physical kWh quantities (consumption, grid import with & without PV, PV generation / used /
  surplus / curtailed / exported, per interval / hour / month / period), structured so a later
  phase can layer avoided-cost (× retail tariff) and export revenue (`MarketPrice` +
  `computeExportRevenue`) → monthly savings, payback, ROI, IRR. No € value or price is computed or
  invented here. Physical and financial layers stay in separate modules.
- **Exports reuse the Reporting primitives**: CSV framing (`csvDocument` — UTF-8 BOM, CRLF, RFC
  4180), the safe filename slugifier and the multi-sheet XLSX builder were extracted into
  `lib/reporting/export-shared.ts` and are shared by Reporting and the Simulator — no parallel
  export architecture.
- **Tests**: `lib/pv-simulator/{simulate,load-profile,csv,xlsx}.test.ts` — **41 cases**
  (simulate 19, load-profile 13, csv 5, xlsx 4) covering the exact spec example, PV < / = / >
  load, zero/negative capacity, a reference plant with no capacity, missing & duplicate intervals,
  DST spring-forward, leap year, monthly aggregation, full-period TOTAL == sum of months,
  rates-from-totals (not averaged), export-disabled / export-enabled behaviour, kW→kWh conversion,
  CSV escaping / filename safety, and XLSX round-trip to four named sheets. Verified end-to-end
  against the real supplied load profile + real Chomakovtsi production data before deployment
  (full 11-month period and a restricted covered window).

## Production status

- **Live in production.** Feature commit `a6a9d0c`, monthly-chunk performance follow-up `67284f2`.
  Vercel production deployment `dpl_HRuY5Hvuc643tege6fMxp8vaSSce` confirmed `READY` and aliased to
  `app.voltessa.ai` on 2026-09-11. `/admin/pv-simulator` verified reachable and admin-gated in
  production (`307 → /login` unauthenticated; `308 → /admin/pv-simulator` from a locale prefix;
  `404` for a near-miss path). No Prisma migration — no schema change. CI (`Lint, type-check,
  build`) green on `67284f2`; `pnpm --filter web test` 202/202; `e2e/admin-routing.spec.ts` 27/27.
  ADR-023 (`docs/ARCHITECT_DECISIONS.md`) is the authoritative record.

## Limitations

- Linear capacity scaling assumes the hypothetical array has the same orientation / shading /
  soiling / temperature / inverter-clipping behaviour as the reference plant, scaled 1:1
  (documented in the UI and report). Chomakovtsi's per-interval production comes from inverter
  power integration, which runs slightly below its manufacturer daily counter — so
  Chomakovtsi-referenced simulations are conservative.
- The supplied profile (Jul 2025 – May 2026) is only ~45 % covered by Chomakovtsi's 15-minute
  telemetry (Jan 2026 onward); the whole-period figures are a lower bound and the covered-days
  figures + coverage % are the interpretable result. Restricting to Jan–May 2026 gives a fully
  covered simulation.
- One reference plant and one real load profile exercised so far.
