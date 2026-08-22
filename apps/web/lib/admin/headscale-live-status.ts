/**
 * Voltessa Gateway milestone (Aug 2026) — live connectivity indicator for
 * `/admin/gateways`. Deliberately separate from `Gateway.status` (the
 * lifecycle field in Postgres): this queries Headscale's own HTTP API
 * directly, at page-load time, and is never written back to the database —
 * a `Gateway` record stays ACTIVE whether or not the physical unit happens
 * to be reachable right now.
 *
 * Uses Headscale's native REST API (`GET /api/v1/node`, Bearer
 * `HEADSCALE_API_KEY`) rather than the SSH+CLI mechanism the provisioning
 * scripts use — this runs inside a Next.js Server Component on Vercel,
 * which has no SSH client/key/network path to the Scaleway VM. The HTTP
 * API is Headscale's own existing capability (same server, same "source of
 * truth" requirement), reached the same way this app already reaches every
 * other external service: an HTTPS call with a bearer secret, matching the
 * `FUSIONSOLAR_GATEWAY_SECRET`/`CRON_SECRET` pattern.
 *
 * No polling, no background job, no caching — one fetch per page render.
 */

const HEADSCALE_NODE_LIST_URL = "https://headscale.voltessa.ai/api/v1/node";
const REQUEST_TIMEOUT_MS = 5000;

type HeadscaleApiNode = {
  nodeKey: string;
  online: boolean;
};

/**
 * Maps `headscaleNodeKey` -> live online state, for every node Headscale
 * currently knows about. Returns `null` if Headscale could not be queried
 * (network error, timeout, missing/invalid API key, non-200 response) —
 * callers must treat `null` as "unknown," never as "offline."
 */
export async function fetchLiveHeadscaleOnlineStateByNodeKey(): Promise<Map<string, boolean> | null> {
  const apiKey = process.env.HEADSCALE_API_KEY;
  if (!apiKey) {
    console.error("[headscale-live-status] HEADSCALE_API_KEY is not configured - live connectivity will show as UNKNOWN.");
    return null;
  }

  try {
    const response = await fetch(HEADSCALE_NODE_LIST_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(`[headscale-live-status] Headscale API returned ${response.status} - live connectivity will show as UNKNOWN.`);
      return null;
    }

    const body = (await response.json()) as { nodes?: HeadscaleApiNode[] };
    const byNodeKey = new Map<string, boolean>();
    for (const node of body.nodes ?? []) {
      byNodeKey.set(node.nodeKey, node.online);
    }
    return byNodeKey;
  } catch (err) {
    console.error("[headscale-live-status] Failed to reach Headscale - live connectivity will show as UNKNOWN.", err);
    return null;
  }
}

export type LiveConnectivity = "ONLINE" | "OFFLINE" | "UNKNOWN";

/** Resolves one gateway's live connectivity from the fetched map, given its stored (stable) Headscale node key. */
export function resolveLiveConnectivity(headscaleNodeKey: string | null, onlineByNodeKey: Map<string, boolean> | null): LiveConnectivity {
  if (!headscaleNodeKey || !onlineByNodeKey) {
    return "UNKNOWN";
  }
  const online = onlineByNodeKey.get(headscaleNodeKey);
  if (online === undefined) {
    // Headscale was reachable and answered, but has no record of this node
    // (e.g. revoked/deleted there) - genuinely not connected, not "unknown".
    return "OFFLINE";
  }
  return online ? "ONLINE" : "OFFLINE";
}
