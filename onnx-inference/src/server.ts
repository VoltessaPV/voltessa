import crypto from "node:crypto";
import http from "node:http";

import * as ort from "onnxruntime-node";

/**
 * Multi-Horizon Self-Learning Forecast milestone. Pure numeric ONNX
 * inference over HTTP - see this package's own README/description in
 * package.json for why this exists as a separate process instead of
 * running inside the Vercel-hosted app. Two routes only:
 *
 *  - POST /infer   run both ONNX models, return raw predictions
 *  - GET  /health   liveness check, no auth (used by the reverse proxy /
 *                    manual verification, never by Voltessa itself)
 *
 * No plant/weather/DB knowledge here at all - Voltessa builds the feature
 * matrices (lib/forecast/ml/feature-schema.ts, unchanged) and does
 * everything else (persistence, reconciliation, promotion) itself; this
 * process only ever sees numbers in, numbers out.
 */

const PORT = Number(process.env.PORT ?? 4200);
const SECRET = process.env.ONNX_INFERENCE_SECRET;

if (!SECRET) {
  console.error("ONNX_INFERENCE_SECRET is not set - refusing to start.");
  process.exit(1);
}

function secretsMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

type InferRequestBody = {
  magnitudeModelOnnx: string; // base64
  shapeModelOnnx: string; // base64
  dailyFeatures: number[][];
  intervalFeatures: number[][];
};

/**
 * Runs both stages fresh per request - no session caching across requests.
 * Both models together are ~400KB and this service has no concurrency
 * pressure at this fleet's current scale (two plants, twice-daily
 * schedule); mirrors automation/'s own "never a kept-alive session"
 * simplicity rather than adding cache-invalidation complexity for when
 * the champion model changes.
 */
async function runInference(body: InferRequestBody): Promise<{ magnitudeCorrectionsKwh: number[]; shapeCorrectionsKw: number[] }> {
  const magnitudeBytes = new Uint8Array(Buffer.from(body.magnitudeModelOnnx, "base64"));
  const shapeBytes = new Uint8Array(Buffer.from(body.shapeModelOnnx, "base64"));

  const [magnitudeSession, shapeSession] = await Promise.all([ort.InferenceSession.create(magnitudeBytes), ort.InferenceSession.create(shapeBytes)]);

  const dailyFeatures = body.dailyFeatures;
  const intervalFeatures = body.intervalFeatures;

  const magnitudeInput = new ort.Tensor("float32", Float32Array.from(dailyFeatures.flat()), [dailyFeatures.length, dailyFeatures[0]!.length]);
  const magnitudeOutput = await magnitudeSession.run({ input: magnitudeInput });
  const magnitudeCorrectionsKwh = Array.from(magnitudeOutput.variable!.data as Float32Array);

  const shapeInput = new ort.Tensor("float32", Float32Array.from(intervalFeatures.flat()), [intervalFeatures.length, intervalFeatures[0]!.length]);
  const shapeOutput = await shapeSession.run({ input: shapeInput });
  const shapeCorrectionsKw = Array.from(shapeOutput.variable!.data as Float32Array);

  return { magnitudeCorrectionsKwh, shapeCorrectionsKw };
}

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method !== "POST" || req.url !== "/infer") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "not_found" }));
        return;
      }

      const provided = req.headers["x-onnx-inference-secret"];
      if (typeof provided !== "string" || !secretsMatch(provided, SECRET!)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }

      const raw = await readBody(req);
      const body = JSON.parse(raw) as InferRequestBody;

      if (!body.magnitudeModelOnnx || !body.shapeModelOnnx || !Array.isArray(body.dailyFeatures) || !Array.isArray(body.intervalFeatures)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid_request_body" }));
        return;
      }

      const result = await runInference(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      console.error("ONNX inference request failed:", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "unknown_error" }));
    }
  })();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Voltessa ONNX Inference Service listening on 127.0.0.1:${PORT}`);
});
