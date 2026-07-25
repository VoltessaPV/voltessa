import { createServer } from "node:http";

import { handleRequest } from "./routes";

const PORT = Number(process.env.PORT ?? 4100);

if (!process.env.AUTOMATION_SERVICE_SECRET) {
  throw new Error("AUTOMATION_SERVICE_SECRET must be set");
}

if (!process.env.FUSIONSOLAR_ATLANTA_USERNAME || !process.env.FUSIONSOLAR_ATLANTA_PASSWORD) {
  throw new Error("FUSIONSOLAR_ATLANTA_USERNAME and FUSIONSOLAR_ATLANTA_PASSWORD must both be set");
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error: unknown) => {
    console.error(`Unhandled error on ${req.method} ${req.url}:`, error);

    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
    }

    res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
  });
});

server.listen(PORT, () => {
  console.log(`Voltessa Automation Service listening on port ${PORT}`);
});
