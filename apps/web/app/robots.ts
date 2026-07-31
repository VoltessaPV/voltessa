import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Never customer-facing: Platform Admin (English-only by design) and
      // the internal diagnostic consoles - both already set `robots:
      // {index:false}` at the page level (app/admin, app/dev layouts);
      // disallowing here too keeps crawlers from even requesting them.
      disallow: ["/admin", "/dev"],
    },
    sitemap: "https://voltessa.ai/sitemap.xml",
  };
}