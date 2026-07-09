import { syncFusionSolarPlantTelemetry } from "@/lib/fusionsolar/sync-plant-telemetry";
import { prisma } from "@/lib/prisma";

export type FusionSolarTelemetryIngestionResult = {
  organizationsProcessed: number;
  organizationsSucceeded: number;
  organizationsFailed: number;
  plantsRequested: number;
  snapshotsCreated: number;
  failures: Array<{
    organizationId: string;
    reason: string;
  }>;
};

export async function ingestFusionSolarPlantTelemetry(): Promise<FusionSolarTelemetryIngestionResult> {
  const connections =
    await prisma.fusionSolarConnection.findMany({
      where: {
        provider: "HuaweiFusionSolar",
      },
      select: {
        id: true,
        organizationId: true,
        accessToken: true,
        refreshToken: true,
        tokenType: true,
        scope: true,
        expiresAt: true,
      },
    });

  let organizationsSucceeded = 0;
  let plantsRequested = 0;
  let snapshotsCreated = 0;

  const failures: FusionSolarTelemetryIngestionResult["failures"] =
    [];

  for (const connection of connections) {
    try {
      const result =
        await syncFusionSolarPlantTelemetry(
          connection.organizationId,
          connection,
        );

      organizationsSucceeded += 1;
      plantsRequested += result.plantsRequested;
      snapshotsCreated += result.snapshotsCreated;
    } catch (error) {
      failures.push({
        organizationId: connection.organizationId,
        reason:
          error instanceof Error
            ? error.message
            : "unknown_error",
      });

      console.error(
        "[FusionSolar Telemetry Ingestion] Organization failed",
        {
          organizationId: connection.organizationId,
          error,
        },
      );
    }
  }

  return {
    organizationsProcessed: connections.length,
    organizationsSucceeded,
    organizationsFailed: failures.length,
    plantsRequested,
    snapshotsCreated,
    failures,
  };
}
