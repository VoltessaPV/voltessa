import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";

export const runtime = "nodejs";

export async function GET() {
  const hostname = "oauth2.fusionsolar.huawei.com";

  try {
    const addresses = await dns.lookup(hostname, {
      all: true,
    });

    return NextResponse.json({
      ok: true,
      hostname,
      addresses,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        hostname,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
              }
            : String(error),
      },
      {
        status: 500,
      },
    );
  }
}