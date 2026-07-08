import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

const hostnames = [
  "google.com",
  "support.huawei.com",
  "intl.fusionsolar.huawei.com",
  "oauth2.fusionsolar.huawei.com",
];

export async function GET() {
  const results = await Promise.all(
    hostnames.map(async (hostname) => {
      try {
        const addresses = await dns.lookup(hostname, {
          all: true,
        });

        return {
          hostname,
          ok: true,
          addresses,
        };
      } catch (error) {
        return {
          hostname,
          ok: false,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                }
              : String(error),
        };
      }
    }),
  );

  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? null,
    results,
  });
}