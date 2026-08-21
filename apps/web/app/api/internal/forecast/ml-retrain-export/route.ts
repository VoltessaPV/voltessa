import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { recordSchedulerRun } from "@/lib/admin/scheduler-run";
import { prisma } from "@/lib/prisma";
import { getCurrentChampion } from "@/lib/forecast/ml/model-registry";
import { findGenuineVintageDays, shouldRetrain, MIN_NEW_VINTAGE_DAYS_TO_RETRAIN } from "@/lib/forecast/ml/genuine-vintage";
import { buildTrainingDataset } from "@/lib/forecast/ml/build-training-dataset";

/**
 * Continuous Retraining Loop milestone. Step 1 of the automatic
 * retraining loop's production path — `voltessa-ml-retrain.timer` (VM)
 * calls this route first. It runs the SAME conservative eligibility
 * check `scripts/ml/retrain-and-promote.ts` (the local/manual reference
 * implementation) uses, and ONLY if eligible, returns the full training
 * dataset in the response body for the VM to save locally and hand to
 * `train.py` (Python/CPU-bound, cannot run on this Vercel deployment —
 * the same reasoning that already put the ONNX Inference Service on the
 * Scaleway VM instead). Never creates a `ForecastModelVersion` row itself
 * — that only ever happens in `ml-retrain-promote`, after training and
 * the existing promotion gate.
 *
 * If NOT eligible, records the `SchedulerRun` itself (status SUCCESS,
 * summary explaining why) since `ml-retrain-promote` will never be called
 * for this cycle — every weekly firing produces exactly one `SchedulerRun`
 * row either way. If eligible, this route does NOT record one yet; the
 * eventual promote-or-reject outcome is what gets recorded, by
 * `ml-retrain-promote`.
 */

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";
const SCHEDULER_NAME = "ml_retrain";

function secretsMatch(providedSecret: string, expectedSecret: string): boolean {
  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(expectedSecret);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return false;
  return secretsMatch(authorization.slice("Bearer ".length), cronSecret);
}

async function handleMlRetrainExport(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();

  try {
    const champion = await getCurrentChampion();
    if (!champion) {
      await recordSchedulerRun({
        schedulerName: SCHEDULER_NAME,
        startedAt,
        status: "SUCCESS",
        summary: { eligible: false, reason: "no_champion" },
      });
      return NextResponse.json({ ok: true, eligible: false, reason: "no_champion" });
    }

    const plants = await prisma.plant.findMany({
      where: { latitude: { not: null }, longitude: { not: null }, capacityKw: { not: null } },
      select: { id: true, name: true },
    });

    const since = new Date(champion.trainingDataEnd.getTime() + 24 * 60 * 60 * 1000);
    const until = new Date();
    const perPlant = await Promise.all(
      plants.map(async (plant) => ({
        plantId: plant.id,
        plantName: plant.name,
        newGenuineVintageDays: (await findGenuineVintageDays(plant.id, since, until)).length,
      })),
    );
    const totalNewGenuineVintageDays = perPlant.reduce((sum, p) => sum + p.newGenuineVintageDays, 0);
    const eligible = shouldRetrain(perPlant.map((p) => p.newGenuineVintageDays));

    if (!eligible) {
      await recordSchedulerRun({
        schedulerName: SCHEDULER_NAME,
        startedAt,
        status: "SUCCESS",
        summary: { eligible: false, totalNewGenuineVintageDays, minRequired: MIN_NEW_VINTAGE_DAYS_TO_RETRAIN, perPlant },
      });
      return NextResponse.json({ ok: true, eligible: false, totalNewGenuineVintageDays, minRequired: MIN_NEW_VINTAGE_DAYS_TO_RETRAIN, perPlant });
    }

    const dataset = await buildTrainingDataset();
    // Not recording a SchedulerRun here - the outcome of THIS cycle isn't known until
    // ml-retrain-promote runs; that route records it.
    return NextResponse.json({ ok: true, eligible: true, totalNewGenuineVintageDays, dataset });
  } catch (error) {
    await recordSchedulerRun({
      schedulerName: SCHEDULER_NAME,
      startedAt,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      { ok: false, error: "ml_retrain_export_failed", reason: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleMlRetrainExport(request);
}
