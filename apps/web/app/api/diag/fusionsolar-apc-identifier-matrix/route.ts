import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { FusionSolarApiError } from "@/lib/fusionsolar/api-client";
import { getActivePowerControlMode } from "@/lib/fusionsolar/get-active-power-control-mode";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

/**
 * TEMPORARY read-only diagnostic route — Active Power Control identifier
 * matrix. Created only to answer one question: which identifier (Plant DN,
 * Smart Dongle DN, inverter DN, meter DN) Huawei's documented
 * configuration-query endpoint actually expects, and whether the plant's
 * multi-Dongle topology explains the observed `failCode 20609`.
 *
 * Calls ONLY the existing, unmodified `getActivePowerControlMode()`
 * (lib/fusionsolar/get-active-power-control-mode.ts) — the read-only v1
 * "configuration" endpoint. Never imports export-control.ts, so it cannot
 * dispatch a task even by accident. No write of any kind, no plant
 * configuration change.
 *
 * Per explicit instruction: delete this route (and this file) once its
 * output has been captured and analyzed — it must never become a permanent
 * part of the diagnostic surface.
 */

const ACTIVE_POWER_CONTROL_MODE_ENDPOINT =
  "/rest/openapi/pvms/nbi/v1/configuration/active-power-control-mode";

type Identifier = {
  label: string;
  identifier: string;
  deviceType: "plant" | "inverter" | "meter" | "smart-dongle" | string;
};

type AttemptResult = {
  label: string;
  identifier: string;
  deviceType: string;
  requestPath: string;
  requestBody: Record<string, unknown>;
  durationMs: number;
  httpStatus: number | null;
  success: boolean | null;
  failCode: number | null;
  message: string | null;
  responseBody: unknown;
};

function deviceTypeLabel(devTypeId: number): string {
  if (devTypeId === 1) return "inverter";
  if (devTypeId === 47) return "meter";
  if (devTypeId === 62) return "smart-dongle";
  return `devTypeId-${devTypeId}`;
}

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { organizationId: true },
  });

  if (!user?.organizationId) {
    return NextResponse.json(
      { ok: false, error: "organization_not_found" },
      { status: 404 },
    );
  }

  const connection = await prisma.fusionSolarConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: user.organizationId,
        provider: "HuaweiFusionSolar",
      },
    },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      tokenType: true,
      scope: true,
      expiresAt: true,
    },
  });

  if (!connection) {
    return NextResponse.json(
      { ok: false, error: "fusionsolar_connection_not_found" },
      { status: 404 },
    );
  }

  const plant = await prisma.plant.findFirst({
    where: {
      organizationId: user.organizationId,
      vendor: "Huawei",
      plantCode: { not: null },
    },
    select: { id: true, name: true, plantCode: true },
  });

  if (!plant?.plantCode) {
    return NextResponse.json({ ok: false, error: "plant_not_found" }, { status: 404 });
  }

  const devices = await prisma.device.findMany({
    where: { plantId: plant.id },
    orderBy: [{ devTypeId: "asc" }, { devName: "asc" }],
    select: { devDn: true, devName: true, devTypeId: true },
  });

  const identifiers: Identifier[] = [
    {
      label: `Plant DN (${plant.name})`,
      identifier: plant.plantCode,
      deviceType: "plant",
    },
    ...devices.map((device) => ({
      label: `${device.devName} (${device.devDn})`,
      identifier: device.devDn,
      deviceType: deviceTypeLabel(device.devTypeId),
    })),
  ];

  const results: AttemptResult[] = [];

  for (const identifier of identifiers) {
    const requestBody = { plantCode: identifier.identifier };
    const startedAt = Date.now();

    try {
      const data = await getActivePowerControlMode(
        connection,
        identifier.identifier,
      );

      results.push({
        label: identifier.label,
        identifier: identifier.identifier,
        deviceType: identifier.deviceType,
        requestPath: ACTIVE_POWER_CONTROL_MODE_ENDPOINT,
        requestBody,
        durationMs: Date.now() - startedAt,
        httpStatus: 200,
        success: true,
        failCode: null,
        message: null,
        responseBody: data,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      if (error instanceof FusionSolarApiError) {
        const parsed =
          error.response && typeof error.response === "object"
            ? (error.response as {
                success?: boolean;
                failCode?: number;
                message?: string | null;
              })
            : null;

        results.push({
          label: identifier.label,
          identifier: identifier.identifier,
          deviceType: identifier.deviceType,
          requestPath: ACTIVE_POWER_CONTROL_MODE_ENDPOINT,
          requestBody,
          durationMs,
          httpStatus: error.httpStatus,
          success: parsed?.success ?? false,
          failCode: parsed?.failCode ?? error.failCode,
          message: parsed?.message ?? error.message,
          responseBody: error.response,
        });
      } else {
        results.push({
          label: identifier.label,
          identifier: identifier.identifier,
          deviceType: identifier.deviceType,
          requestPath: ACTIVE_POWER_CONTROL_MODE_ENDPOINT,
          requestBody,
          durationMs,
          httpStatus: null,
          success: null,
          failCode: null,
          message: error instanceof Error ? error.message : String(error),
          responseBody: null,
        });
      }
    }
  }

  const matrix = results.map((r) => ({
    identifier: r.label,
    deviceType: r.deviceType,
    result: r.success === true ? "OK" : r.success === false ? "FAIL" : "ERROR",
    failCode: r.failCode,
    message: r.message,
    durationMs: r.durationMs,
  }));

  return NextResponse.json({
    ok: true,
    plantId: plant.id,
    plantName: plant.name,
    identifiersTested: identifiers.length,
    matrix,
    results,
  });
}
