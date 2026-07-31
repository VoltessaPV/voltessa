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
- A second, independent daily job (`voltessa-automation-reconciliation.timer`,
  06:00 Europe/Sofia) is the one place that reads FusionSolar's real state and
  corrects Voltessa's stored record if it has drifted (e.g. a manual change
  via `/dev/huawei-api`) — mirrors the existing telemetry/market-price
  scheduler split (ADR-009) of keeping different-cadence jobs in separate
  systemd units.

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