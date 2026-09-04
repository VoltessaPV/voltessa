import { NextRequest, NextResponse } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-session";
import { Permissions } from "@/lib/auth/permissions";
import { updateMarketPriceAutomationForOrganization } from "@/lib/automation/update-market-price-automation";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Mobile Client Architecture milestone (ADR-020), M4. Organization-scoped
 * (not plant-scoped) - matches `AutomationSettings`'s own schema, which is
 * keyed by `organizationId`, not `plantId`, exactly like the Automations
 * page itself reads/writes it.
 *
 * GET: the same plain `prisma.automationSettings.findUnique` the
 * Automations page already runs inline in its own `page.tsx` - no
 * separate read function existed to reuse, so this route does the
 * identical query, not a new implementation of the read logic (there is
 * none to duplicate).
 *
 * POST: reuses `updateMarketPriceAutomationForOrganization` verbatim -
 * the same sanitize/validate/upsert logic the Web Server Action
 * (`automations/actions.ts`'s `updateMarketPriceAutomation`) calls, only
 * the caller-resolution differs (Bearer vs. cookie).
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, Permissions.canViewPlants);

  if (!auth.ok) {
    return auth.response;
  }

  const settings = await prisma.automationSettings.findUnique({
    where: { organizationId: auth.user.organizationId },
    select: {
      automationEnabled: true,
      minimumExportPrice: true,
      currency: true,
      enabledDays: true,
    },
  });

  return NextResponse.json({
    automationEnabled: settings?.automationEnabled ?? false,
    minimumExportPrice: settings?.minimumExportPrice.toString() ?? null,
    currency: settings?.currency ?? null,
    enabledDays: settings?.enabledDays ?? [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, Permissions.canManagePlants);

  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { enabled, minimumExportPrice, enabledDays } = (body ?? {}) as {
    enabled?: unknown;
    minimumExportPrice?: unknown;
    enabledDays?: unknown;
  };

  if (
    typeof enabled !== "boolean" ||
    typeof minimumExportPrice !== "string" ||
    !Array.isArray(enabledDays) ||
    !enabledDays.every((day) => typeof day === "string")
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await updateMarketPriceAutomationForOrganization({
    organizationId: auth.user.organizationId,
    enabled,
    minimumExportPrice,
    enabledDays,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
