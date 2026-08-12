/**
 * Multi-Horizon Self-Learning Forecast milestone. Thin authenticated HTTP
 * client for the standalone ONNX Inference Service (see /onnx-inference at
 * the repo root) - onnxruntime-node's native binary (libonnxruntime.so.1)
 * does not load in Vercel's serverless runtime (confirmed in production:
 * two standard Next.js fixes, outputFileTracingIncludes and
 * serverExternalPackages, both failed to resolve it). Mirrors
 * lib/automation-client.ts's exact shape (shared-secret header, JSON
 * body, transport-level errors only) - Voltessa performs an HTTP request
 * here and never imports onnxruntime-node itself.
 */

function getOnnxInferenceServiceConfiguration(): { serviceUrl: string; serviceSecret: string } {
  const serviceUrl = process.env.ONNX_INFERENCE_SERVICE_URL;
  const serviceSecret = process.env.ONNX_INFERENCE_SERVICE_SECRET;

  if (!serviceUrl || !serviceSecret) {
    throw new Error("ONNX Inference Service environment variables are not configured");
  }

  return { serviceUrl, serviceSecret };
}

const REQUEST_TIMEOUT_MS = 60000;

export async function runOnnxInference(params: {
  magnitudeModelOnnx: Uint8Array;
  shapeModelOnnx: Uint8Array;
  dailyFeatures: number[][];
  intervalFeatures: number[][];
}): Promise<{ magnitudeCorrectionsKwh: number[]; shapeCorrectionsKw: number[] }> {
  const { serviceUrl, serviceSecret } = getOnnxInferenceServiceConfiguration();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;

  try {
    // A leading "/" here would resolve relative to the ORIGIN, discarding
    // serviceUrl's own /onnx-inference path prefix entirely (confirmed in
    // production: requests were landing on the wrong nginx location block,
    // fusionsolar-proxy.service on :3000, not this service on :4200) -
    // "infer" (no leading slash) against a trailing-slash base is required
    // for correct path-relative resolution.
    const inferUrl = new URL("infer", serviceUrl.endsWith("/") ? serviceUrl : `${serviceUrl}/`).toString();
    response = await fetch(inferUrl, {
      method: "POST",
      headers: {
        "x-onnx-inference-secret": serviceSecret,
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        magnitudeModelOnnx: Buffer.from(params.magnitudeModelOnnx).toString("base64"),
        shapeModelOnnx: Buffer.from(params.shapeModelOnnx).toString("base64"),
        dailyFeatures: params.dailyFeatures,
        intervalFeatures: params.intervalFeatures,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`ONNX Inference Service did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();

  let parsed: { ok: boolean; error?: string; magnitudeCorrectionsKwh?: number[]; shapeCorrectionsKw?: number[] };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`ONNX Inference Service returned a non-JSON response: HTTP ${response.status}`);
  }

  if (!response.ok || !parsed.ok || !parsed.magnitudeCorrectionsKwh || !parsed.shapeCorrectionsKw) {
    throw new Error(`ONNX Inference Service request failed: HTTP ${response.status} ${parsed.error ?? ""}`);
  }

  return { magnitudeCorrectionsKwh: parsed.magnitudeCorrectionsKwh, shapeCorrectionsKw: parsed.shapeCorrectionsKw };
}
