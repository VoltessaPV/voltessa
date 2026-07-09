import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { ingestFusionSolarPlantTelemetry } from "@/lib/fusionsolar/ingest-plant-telemetry";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

function secretsMatch(
  providedSecret: string,
  expectedSecret: string,
): boolean {
  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(expectedSecret);

  return (
    provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected)
  );
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return false;
  }

  const authorization = request.headers.get("authorization");

  if (
    !authorization ||
    !authorization.startsWith("Bearer ")
  ) {
    return false;
  }

  const providedSecret = authorization.slice(
    "Bearer ".length,
  );

  return secretsMatch(providedSecret, cronSecret);
}

async function handleIngestion(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error(
      "[FusionSolar Telemetry Ingestion] CRON_SECRET is not configured",
    );

    return NextResponse.json(
      {
        ok: false,
        error: "server_not_configured",
      },
      {
        status: 500,
      },
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  try {
    const result =
      await ingestFusionSolarPlantTelemetry();

    return NextResponse.json({
      ok: result.organizationsFailed === 0,
      ...result,
    });
  } catch (error) {
    console.error(
      "[FusionSolar Telemetry Ingestion] Failed",
      {
        error,
      },
    );

    return NextResponse.json(
      {
        ok: false,
        error: "fusionsolar_telemetry_ingestion_failed",
        reason:
          error instanceof Error
            ? error.message
            : "unknown_error",
      },
      {
        status: 500,
      },
    );
  }
}
export async function GET(request: Request) {
  return handleIngestion(request);
}

export async function POST(request: Request) {
  return handleIngestion(request);
}
