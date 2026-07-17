# Testing

## Current state (be honest about this)

- **`apps/web` has zero automated tests.** There are no `*.test.ts`/`*.spec.ts` files anywhere
  under `apps/web`. Commit messages like `test FusionSolar access token refresh helper` in the
  history refer to manual testing via diagnostic routes (`app/api/diag/fusionsolar-*`), not
  automated tests — those diagnostic endpoints are the closest thing to an integration-test harness
  the project currently has, and they hit the real (or gateway-proxied) FusionSolar API.
- **`apps/api` has exactly one test**, the NestJS-generated boilerplate
  (`apps/api/src/app.controller.spec.ts`, checks `AppController.getHello()` returns `"Hello
  World!"`) plus an unmodified e2e boilerplate spec (`apps/api/test/app.e2e-spec.ts`). None of the
  real domain logic (`DecisionService`, `AutomationService`, `PlantService`, `MarketService`) has
  test coverage yet, despite `apps/api` being the cleanest, most testable code in the repo (plain
  injectable classes, no I/O in the core decision logic).
- There is no CI, so nothing currently runs these tests automatically on push — `pnpm test` in
  `apps/api` must be run manually.

This doc describes how to run what exists and how to add tests going forward, prioritized by
what's actually risky in this codebase (see `docs/AI_PLAYBOOK.md` — automation/decision logic and
the FusionSolar integration carry real financial/operational risk).

## Running tests today

`apps/api` (Jest, configured in `apps/api/package.json`'s `jest` block: `rootDir: src`, test regex
`.*\.spec\.ts$`, `ts-jest`):

```sh
cd apps/api
pnpm test                    # all *.spec.ts under src/
pnpm test -- automation      # matches by filename substring, e.g. runs automation.service.spec.ts
pnpm test:watch
pnpm test:cov                # coverage report -> apps/api/coverage
pnpm test:debug              # attach a debugger, runs in-band
pnpm test:e2e                # separate config: apps/api/test/jest-e2e.json
```

`apps/web`: no test runner is configured. If you add the first test file, you'll also need to add a
test script and a runner (see "Adding tests to apps/web" below) — don't assume one silently exists.

## What to prioritize testing, in order

1. **`DecisionService.decide()`** (`apps/api/src/decision/decision.service.ts`) — pure function,
   price + thresholds → `STOP_EXPORT`/`RESUME_EXPORT`. Trivial to test, and it's the core financial
   decision in the product. Cover: price exactly at threshold, price above/below, and — once
   `resumeExportThreshold` diverges from `stopExportThreshold` in real usage — the hysteresis gap
   between them (currently `AutomationService.evaluate()` always passes the same value for both,
   see `apps/api/src/automation/automation.service.ts`).
2. **`AutomationService.shouldSendCommand()`** (same file) — the dedup/no-duplicate-command logic
   that `docs/CLIENT_REQUIREMENTS.md` explicitly requires ("no duplicate commands"). Cover all
   combinations of `ExportMode` (`UNKNOWN`, `ZERO_EXPORT`, `NO_LIMIT`) × `PlantCommand`
   (`STOP_EXPORT`, `RESUME_EXPORT`).
3. **`getValidFusionSolarAccessToken`** (`apps/web/lib/fusionsolar/get-valid-access-token.ts`) —
   token-expiry buffer logic, and the retryable-vs-fatal network error classification
   (`isRetryableNetworkError`). This is exactly the kind of logic that's easy to silently break
   during a refactor and hard to notice until OAuth starts failing in production.
4. **`lib/auth/permissions.ts`** and **`lib/auth/session.ts`'s `requirePermission()`** (the
   enforcement point since Sprint 1A, ADR-006) — a wrong entry in `Permissions.can*`, or a call site
   using the wrong bucket, is a silent authorization bug. Cheap to test exhaustively (four roles ×
   four permission buckets).
5. **Prisma `Decimal` conversion helpers** (e.g. `toDecimal()` in
   `apps/web/lib/fusionsolar/sync-plants.ts`) — cover `null`, empty string, and malformed numeric
   input, since this data comes from an external API response, not user input you control.
6. Route handlers and Server Actions (`app/api/**/route.ts`, `app/onboarding/actions.ts`) last —
   they're thin wrappers around the above once the logic underneath is covered; an e2e/integration
   test is more valuable here than a unit test of the handler itself.

## `apps/api` conventions for new tests

Follow the existing Nest testing-module pattern (`apps/api/src/app.controller.spec.ts`):

```ts
const module: TestingModule = await Test.createTestingModule({
  controllers: [SomeController],
  providers: [SomeService, /* mocks for its dependencies */],
}).compile();
```

For services with injected interfaces (e.g. `AutomationService`'s `PLANT_DRIVER` token), provide a
test double via the same token:

```ts
{ provide: PLANT_DRIVER, useValue: { execute: jest.fn() } }
```

rather than instantiating `MockDriver` directly — that keeps the test honest about depending on the
interface, matching ADR-001.

Place `*.spec.ts` next to the file it tests, inside the same feature folder (`decision/`,
`automation/`, `plant/`, `market/`), matching the Nest CLI's default colocated convention.

## Adding tests to `apps/web`

There is no runner configured yet. Since `apps/web` is Next.js/React 19 with server-only logic
(Prisma, Server Actions, route handlers) and no client components at all today, prefer a
Node-based unit test runner over a browser/component-testing setup — the highest-value coverage
(see the priority list above) is plain async functions, not rendered UI. Whatever runner you
introduce (Vitest is the natural fit given Next.js 16 + ESM `"type": "module"` in
`apps/web/package.json`), add the corresponding `test`/`test:watch` scripts to
`apps/web/package.json` and document them here and in `CLAUDE.md`'s Commands section in the same
PR — don't add a test file without also making it runnable via a documented command.

Do not write tests that hit the real FusionSolar gateway or a real Google OAuth flow. Mock
`fetch`/the gateway boundary (`callFusionSolarApi`) and the Prisma client at the function boundary
you're testing, following the `Result<T>`/thrown-error contract already established for that
function (see `docs/CODING_STANDARDS.md`).

## Manual verification (until `apps/web` has real tests)

The diagnostic routes under `apps/web/app/api/diag/*` (`fusionsolar-connection`,
`fusionsolar-devices`, `fusionsolar-dns`, `fusionsolar-plant-realtime`, `fusionsolar-stations`,
`fusionsolar-sync-devices`, `fusionsolar-sync-plant-telemetry`, `fusionsolar-sync-plants`) are the
current de facto integration-test surface for the FusionSolar integration. When you change anything
in `lib/fusionsolar/*`, hit the relevant diagnostic route against a real (or sandbox) connection
before considering the change verified — don't rely on `turbo build`/`turbo check-types` passing as
a substitute for confirming the integration still works end to end.
