import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Regression test for the Trader Workflow Simplification milestone's
 * required nav order: Clients, Dashboard, Market, BESS, Automations,
 * Alerts, Settings. A static regression guard, not a live authenticated
 * flow - there is no functional test database in CI (see
 * `admin-routing.spec.ts`'s identical constraint), and exercising a real
 * Trader session here would need one. This checks the actual source
 * `buildTraderNavigation` renders from, the same way `admin-routing.spec.ts`
 * already checks `adminNavigation`'s hrefs directly from source rather than
 * a live session.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe("trader sidebar navigation source (static regression guard)", () => {
  const sidebarPath = path.join(__dirname, "../components/platform/layout/AppSidebar.tsx");
  const sidebarSource = readFileSync(sidebarPath, "utf-8");

  test("buildTraderNavigation lists hrefs in the required order: Clients, Dashboard, Market, BESS, Automations, Alerts, Settings", () => {
    const functionMatch = sidebarSource.match(
      /function buildTraderNavigation\([\s\S]*?\{\s*return \[([\s\S]*?)\n\s*\];\s*\}/,
    );
    const arrayBody = functionMatch?.[1];
    expect(arrayBody, "buildTraderNavigation array not found in AppSidebar.tsx").toBeDefined();
    if (!arrayBody) return;

    const hrefs = [...arrayBody.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(hrefs).toEqual([
      "/clients",
      "/dashboard",
      "/market",
      "/bess",
      "/automations",
      "/alerts",
      "/settings",
    ]);
  });
});
