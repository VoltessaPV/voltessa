import { defineConfig, devices } from "@playwright/test";

/**
 * apps/web's first automated test runner (see docs/TESTING.md — this
 * codebase previously had zero automated tests here). Deliberately narrow
 * in scope: `e2e/` covers routing/middleware-level regressions that need a
 * real running server to verify (redirects, status codes) - not a general
 * component/unit-testing setup. There is no test database in CI (see
 * `.github/workflows/ci.yml`'s own comment on its placeholder `DATABASE_URL`),
 * so every test here is deliberately scoped to what's true for an
 * unauthenticated request - no sign-in flow, no Prisma-backed fixture data.
 *
 * `webServer` runs `pnpm start` (an already-built `.next`, not `next dev`)
 * so this exercises the same production build `turbo build` already
 * produced earlier in CI, not a separate dev-mode server with different
 * middleware/caching behavior.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
