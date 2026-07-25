/**
 * Thin authenticated HTTP client for the standalone Automation Service
 * (see /automation at the repo root) - the only place that launches
 * Playwright or knows anything about FusionSolar's portal. Voltessa only
 * performs HTTP requests here; it never imports browser automation.
 */
function getAutomationServiceConfiguration(): { serviceUrl: string; serviceSecret: string } {
  const serviceUrl = process.env.AUTOMATION_SERVICE_URL;
  const serviceSecret = process.env.AUTOMATION_SERVICE_SECRET;

  if (!serviceUrl || !serviceSecret) {
    throw new Error("Automation Service environment variables are not configured");
  }

  return { serviceUrl, serviceSecret };
}

/**
 * Comfortably above the slowest real, legitimate run observed for any of
 * the three operations (a full three-dongle Zero Export/No Limit change
 * includes up to a 120s Save-confirmation wait per dongle), but still
 * safely under this route's own 300s Vercel maxDuration (vercel.json) -
 * leaves room for this timeout to fire and return a clean error instead
 * of an abrupt platform-level function kill.
 */
const REQUEST_TIMEOUT_MS = 280000;

/**
 * POSTs to the Automation Service and returns its parsed JSON body as-is
 * (the service's own responses already carry a `success` flag and, on
 * failure, an `error`/`failure` shape) - only a transport-level failure
 * (network error, timeout, non-JSON response) throws here.
 */
export async function callAutomationService<T>(path: string): Promise<T> {
  const { serviceUrl, serviceSecret } = getAutomationServiceConfiguration();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(new URL(path, serviceUrl).toString(), {
      method: "POST",
      headers: {
        "x-automation-secret": serviceSecret,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Automation Service did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(`Automation Service returned a non-JSON response: HTTP ${response.status}`);
  }
}
