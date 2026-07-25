import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { handleNoLimit, handleStatus, handleZeroExport } from "./controller.ts";

type RouteHandler = () => Promise<unknown>;

/** Exactly three endpoints, Atlanta only. Nothing else is routed. */
const ROUTES: Record<string, RouteHandler> = {
  "POST /automation/fusionsolar/atlanta/status": handleStatus,
  "POST /automation/fusionsolar/atlanta/zero-export": handleZeroExport,
  "POST /automation/fusionsolar/atlanta/no-limit": handleNoLimit,
};

/**
 * Shared-secret check, same shape as the existing FUSIONSOLAR_GATEWAY_SECRET/
 * CRON_SECRET pattern already used elsewhere in this codebase:
 * crypto.timingSafeEqual, not `===`. server.ts refuses to start if
 * AUTOMATION_SERVICE_SECRET isn't set, so it's always present here.
 */
function isAuthorized(req: IncomingMessage): boolean {
  const expected = process.env.AUTOMATION_SERVICE_SECRET ?? "";
  const provided = req.headers["x-automation-secret"];

  if (typeof provided !== "string") {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  /** Unauthenticated operational health check - not one of the three
   *  automation operations, just liveness for the deploying operator. */
  if (req.method === "GET" && url.pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end("OK");
    return;
  }

  const routeKey = `${req.method} ${url.pathname}`;
  const handler = ROUTES[routeKey];

  if (!handler) {
    sendJson(res, 404, { success: false, error: "Not found" });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { success: false, error: "Unauthorized" });
    return;
  }

  const result = await handler();
  sendJson(res, 200, result);
}
