import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { recordSchedulerRun } from "@/lib/admin/scheduler-run";
import { registerCandidate } from "@/lib/forecast/ml/model-registry";
import { evaluateAndPromote } from "@/lib/forecast/ml/promotion";

/**
 * Continuous Retraining Loop milestone. Step 2 of the automatic
 * retraining loop's production path — after the VM has run `train.py`
 * against the dataset `ml-retrain-export` returned, it POSTs the
 * resulting manifest + two ONNX artifacts here. This route does exactly
 * two things, both EXISTING, unmodified functions:
 *
 *   1. `registerCandidate` — a new `ForecastModelVersion` with status
 *      CANDIDATE. Never CHAMPION. A candidate has zero effect on
 *      production inference until step 2 below.
 *   2. `evaluateAndPromote` — the existing champion/challenger gate.
 *      Promotes ONLY if every check passes; otherwise marks the
 *      candidate REJECTED with its reason and leaves the current
 *      champion untouched.
 *
 * A training run can never become champion by merely completing — this
 * route is the only path to CHAMPION status for anything other than the
 * one-time cold-start registration, and it always goes through the gate.
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

type RetrainManifest = {
  featureSchemaVersion: string;
  stage1Family: "LIGHTGBM" | "XGBOOST";
  stage2Family: "LIGHTGBM" | "XGBOOST";
  trainingDataStart: string;
  trainingDataEnd: string;
  trainingSampleCount: number;
  trueVintageSampleCount: number;
  plantsCovered: string[];
  validationMetrics: unknown;
  hyperparameters: unknown;
};

async function handleMlRetrainPromote(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();

  try {
    const body = (await request.json()) as {
      manifest: RetrainManifest;
      magnitudeModelOnnxBase64: string;
      shapeModelOnnxBase64: string;
    };
    const { manifest, magnitudeModelOnnxBase64, shapeModelOnnxBase64 } = body;

    const versionLabel = `${manifest.stage1Family.toLowerCase()}-${manifest.stage2Family.toLowerCase()}-${new Date().toISOString().slice(0, 10)}-retrain`;

    const candidate = await registerCandidate({
      versionLabel,
      family: manifest.stage2Family,
      magnitudeModelOnnx: Buffer.from(magnitudeModelOnnxBase64, "base64"),
      shapeModelOnnx: Buffer.from(shapeModelOnnxBase64, "base64"),
      featureSchemaVersion: manifest.featureSchemaVersion,
      hyperparameters: { stage1Family: manifest.stage1Family, stage2Family: manifest.stage2Family, ...(manifest.hyperparameters as object) },
      trainingDataStart: new Date(manifest.trainingDataStart),
      trainingDataEnd: new Date(manifest.trainingDataEnd),
      trainingSampleCount: manifest.trainingSampleCount,
      trueVintageSampleCount: manifest.trueVintageSampleCount,
      plantsCovered: manifest.plantsCovered,
      validationMetrics: manifest.validationMetrics,
    });

    const gate = await evaluateAndPromote(candidate.id);

    await recordSchedulerRun({
      schedulerName: SCHEDULER_NAME,
      startedAt,
      status: "SUCCESS",
      summary: { candidateId: candidate.id, versionLabel: candidate.versionLabel, promoted: gate.passed, failedChecks: gate.failedChecks },
    });

    return NextResponse.json({ ok: true, candidateId: candidate.id, versionLabel: candidate.versionLabel, promoted: gate.passed, failedChecks: gate.failedChecks });
  } catch (error) {
    await recordSchedulerRun({
      schedulerName: SCHEDULER_NAME,
      startedAt,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      { ok: false, error: "ml_retrain_promote_failed", reason: error instanceof Error ? error.message : "unknown_error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleMlRetrainPromote(request);
}
