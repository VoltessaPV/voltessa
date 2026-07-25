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
 * POSTs to the Automation Service and returns its parsed JSON body as-is
 * (the service's own responses already carry a `success` flag and, on
 * failure, an `error`/`failure` shape) - only a transport-level failure
 * (network error, non-JSON response) throws here.
 */
export async function callAutomationService<T>(path: string): Promise<T> {
  const { serviceUrl, serviceSecret } = getAutomationServiceConfiguration();

  const response = await fetch(new URL(path, serviceUrl).toString(), {
    method: "POST",
    headers: {
      "x-automation-secret": serviceSecret,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const responseText = await response.text();

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(`Automation Service returned a non-JSON response: HTTP ${response.status}`);
  }
}
