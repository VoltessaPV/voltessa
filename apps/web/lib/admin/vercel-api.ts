/**
 * Platform Health & Operations Center milestone (Sections 6 + 7, Runtime
 * Errors + Deployments). Vercel's own REST API — distinct from, and
 * unrelated to, the Vercel MCP tools an AI coding session has access to;
 * those only exist inside that session's own tooling and are never
 * reachable from code running on Vercel's infrastructure. Showing live
 * deployment/runtime-error data on this page requires the deployed app
 * itself to hold a Vercel API credential, which does not exist in this
 * codebase today (confirmed: no `VERCEL_API_TOKEN` in `turbo.json`/env
 * files before this milestone) — a genuine "credentials unavailable" gap,
 * not something to fabricate around.
 *
 * Per explicit product decision: ship the full architecture and UI now,
 * gated by `isVercelApiConfigured()`, so both sections show a clear
 * "Waiting for VERCEL_API_TOKEN" state until the token is provisioned —
 * at which point these functions start returning real data with no further
 * code changes. Every field read below is a genuine, documented Vercel REST
 * API field; nothing here is invented or simulated.
 */

const VERCEL_API_BASE_URL = "https://api.vercel.com";

export function isVercelApiConfigured(): boolean {
  return Boolean(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID);
}

function buildVercelUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(path, VERCEL_API_BASE_URL);
  const teamId = process.env.VERCEL_TEAM_ID;
  if (teamId) {
    url.searchParams.set("teamId", teamId);
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function vercelFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = process.env.VERCEL_API_TOKEN;
  const response = await fetch(buildVercelUrl(path, params), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Vercel API request failed: HTTP ${response.status} for ${path}`);
  }

  return (await response.json()) as T;
}

export type VercelDeploymentSummary = {
  id: string;
  url: string;
  state: string;
  target: string | null;
  createdAt: Date;
  readyAt: Date | null;
  commitSha: string | null;
  commitBranch: string | null;
};

export type DeploymentHealthResult =
  | { available: false; reason: "waiting_for_token" }
  | { available: false; reason: "request_failed"; errorMessage: string }
  | {
      available: true;
      current: VercelDeploymentSummary | null;
      previous: VercelDeploymentSummary | null;
      latestPreview: VercelDeploymentSummary | null;
    };

type RawVercelDeployment = {
  uid: string;
  url: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  created: number;
  ready?: number;
  meta?: { githubCommitSha?: string; githubCommitRef?: string };
};

function toSummary(deployment: RawVercelDeployment): VercelDeploymentSummary {
  return {
    id: deployment.uid,
    url: deployment.url,
    state: deployment.state ?? deployment.readyState ?? "UNKNOWN",
    target: deployment.target ?? null,
    createdAt: new Date(deployment.created),
    readyAt: deployment.ready ? new Date(deployment.ready) : null,
    commitSha: deployment.meta?.githubCommitSha ?? null,
    commitBranch: deployment.meta?.githubCommitRef ?? null,
  };
}

/** Section 7 — Deployments. Uses Vercel's documented "List Deployments" endpoint (`GET /v6/deployments`). */
export async function getDeploymentHealth(): Promise<DeploymentHealthResult> {
  if (!isVercelApiConfigured()) {
    return { available: false, reason: "waiting_for_token" };
  }

  try {
    const projectId = process.env.VERCEL_PROJECT_ID as string;
    const data = await vercelFetch<{ deployments: RawVercelDeployment[] }>("/v6/deployments", {
      projectId,
      limit: "20",
    });

    const production = data.deployments.filter((d) => d.target === "production");
    const previews = data.deployments.filter((d) => d.target !== "production");

    return {
      available: true,
      current: production[0] ? toSummary(production[0]) : null,
      previous: production[1] ? toSummary(production[1]) : null,
      latestPreview: previews[0] ? toSummary(previews[0]) : null,
    };
  } catch (error) {
    return {
      available: false,
      reason: "request_failed",
      errorMessage: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

export type RuntimeErrorGroup = {
  message: string;
  occurrences: number;
  latestOccurrence: Date;
  deploymentId: string;
};

export type RuntimeErrorsResult =
  | { available: false; reason: "waiting_for_token" }
  | { available: false; reason: "request_failed"; errorMessage: string }
  | { available: true; groups: RuntimeErrorGroup[] };

type RawDeploymentEvent = {
  type?: string;
  created: number;
  payload?: { text?: string; level?: string };
};

/**
 * Section 6 — Runtime Errors. Uses Vercel's documented "Get Deployment
 * Events" endpoint (`GET /v3/deployments/{id}/events`) against the current
 * production deployment, filtering for error-level lines and grouping by
 * message text (trend/occurrence counting done here, not by Vercel) — the
 * same "group by error" requirement the Operations Center spec calls for,
 * built from real log lines rather than a bespoke error-tracking service.
 */
export async function getRuntimeErrorGroups(): Promise<RuntimeErrorsResult> {
  if (!isVercelApiConfigured()) {
    return { available: false, reason: "waiting_for_token" };
  }

  try {
    const deploymentHealth = await getDeploymentHealth();
    if (!deploymentHealth.available || !deploymentHealth.current) {
      return { available: true, groups: [] };
    }

    const events = await vercelFetch<RawDeploymentEvent[]>(
      `/v3/deployments/${deploymentHealth.current.id}/events`,
    );

    const errorEvents = events.filter(
      (event) => event.payload?.level === "error" || event.type === "stderr",
    );

    const groups = new Map<string, RuntimeErrorGroup>();
    for (const event of errorEvents) {
      const message = (event.payload?.text ?? "unknown_error").slice(0, 200);
      const existing = groups.get(message);
      const occurredAt = new Date(event.created);

      if (existing) {
        existing.occurrences += 1;
        if (occurredAt > existing.latestOccurrence) {
          existing.latestOccurrence = occurredAt;
        }
      } else {
        groups.set(message, {
          message,
          occurrences: 1,
          latestOccurrence: occurredAt,
          deploymentId: deploymentHealth.current.id,
        });
      }
    }

    return {
      available: true,
      groups: [...groups.values()].sort((a, b) => b.occurrences - a.occurrences),
    };
  } catch (error) {
    return {
      available: false,
      reason: "request_failed",
      errorMessage: error instanceof Error ? error.message : "unknown_error",
    };
  }
}
