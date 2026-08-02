import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Regression test for the "Platform Admin under a locale prefix" bug: after
 * the i18n rollout, `/en/admin`/`/bg/admin` 404'd because a shared nav
 * component's admin links used next-intl's locale-aware `Link`. `/admin` is
 * its own English-only root, physically outside `app/[locale]/`, and must
 * never be reachable (or generated) as `/en/admin` or `/bg/admin`. See
 * `proxy.ts`'s `LOCALIZED_ADMIN_PREFIX_RE` and `AppSidebar.tsx`'s own doc
 * comments for the full fix.
 *
 * There is no functional test database in CI (see `.github/workflows/ci.yml`'s
 * placeholder `DATABASE_URL`), so this only ever exercises the unauthenticated
 * path - `getCurrentUser()` (`lib/auth/session.ts`) returns `null` before any
 * Prisma call when there is no session, so every request below is safe to run
 * against CI's `next start` server with no real database behind it.
 *
 * Two things are checked, matching the two layers of the actual fix:
 * 1. HTTP-level: the routes/redirects below, against a real running server.
 * 2. Source-level: `AppSidebar.tsx` never regresses back to generating a
 *    locale-prefixed admin href, or rendering admin links with next-intl's
 *    locale-aware `Link` instead of plain `next/link`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe("unauthenticated admin routes never 404", () => {
  for (const adminPath of ["/admin", "/admin/users", "/admin/traders", "/admin/operations", "/admin/historical-imports"]) {
    test(`GET ${adminPath} redirects to /login instead of 404ing`, async ({ request }) => {
      const response = await request.get(adminPath, { maxRedirects: 0 });

      expect(response.status(), `${adminPath} must never 404`).not.toBe(404);
      expect([307, 308]).toContain(response.status());

      const location = response.headers()["location"] ?? "";
      expect(location).toMatch(/\/login(\?|$)/);
    });
  }

  for (const adminPath of ["/admin", "/admin/users", "/admin/traders", "/admin/operations", "/admin/historical-imports"]) {
    test(`${adminPath} ultimately reaches the login page when followed`, async ({ page }) => {
      const response = await page.goto(adminPath);

      expect(response?.status() ?? 0).toBeLessThan(400);
      expect(page.url()).toMatch(/\/login(\?|$)/);
    });
  }
});

test.describe("locale-prefixed admin URLs redirect to their unprefixed equivalent", () => {
  const cases: Array<[from: string, to: string]> = [
    ["/en/admin", "/admin"],
    ["/bg/admin", "/admin"],
    ["/en/admin/users", "/admin/users"],
    ["/bg/admin/users", "/admin/users"],
    ["/en/admin/traders", "/admin/traders"],
    ["/bg/admin/traders", "/admin/traders"],
  ];

  for (const [from, to] of cases) {
    test(`GET ${from} -> 308 redirect -> ${to}`, async ({ request }) => {
      const response = await request.get(from, { maxRedirects: 0 });

      expect(response.status()).toBe(308);

      const location = response.headers()["location"] ?? "";
      const locationPath = new URL(location, "http://localhost:3000").pathname;
      expect(locationPath).toBe(to);
    });
  }
});

test.describe("admin sidebar navigation source (static regression guard)", () => {
  const sidebarPath = path.join(__dirname, "../components/platform/layout/AppSidebar.tsx");
  const sidebarSource = readFileSync(sidebarPath, "utf-8");

  test("every adminNavigation href is an unprefixed /admin path", () => {
    const arrayMatch = sidebarSource.match(/const adminNavigation = \[([\s\S]*?)\n\];/);
    const arrayBody = arrayMatch?.[1];
    expect(arrayBody, "adminNavigation array not found in AppSidebar.tsx").toBeDefined();
    if (!arrayBody) return;

    const hrefs = [...arrayBody.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);

    for (const href of hrefs) {
      expect(href, `admin nav href "${href}" must start with /admin`).toMatch(/^\/admin(\/|$)/);
      expect(href, `admin nav href "${href}" must not carry a locale prefix`).not.toMatch(
        /^\/(en|bg)(\/|$)/,
      );
    }
  });

  test("adminNavigation is rendered with plain next/link, not the locale-aware Link", () => {
    const renderMatch = sidebarSource.match(
      /\{adminNavigation\.map\(\(item\) => \(([\s\S]*?)\)\)\}/,
    );
    const renderBlock = renderMatch?.[1];
    expect(renderBlock, "adminNavigation render block not found in AppSidebar.tsx").toBeDefined();
    if (!renderBlock) return;

    expect(renderBlock).toMatch(/<NextLink\b/);
    expect(renderBlock).not.toMatch(/<Link\b/);
  });

  test("NextLink is imported from next/link as a binding distinct from the locale-aware Link", () => {
    expect(sidebarSource).toMatch(/import NextLink from "next\/link";/);
    expect(sidebarSource).toMatch(/import \{ Link \} from "@\/lib\/i18n\/navigation";/);
  });
});
