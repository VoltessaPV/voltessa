/**
 * Static fallback - the fixed header can't know a specific plant's name
 * without a duplicate query (this file has no server-only imports so it's
 * safe to pull into the client-side heading registry). The plant's actual
 * name is still shown prominently in the page body itself.
 */
export const pageHeading = {
  eyebrow: "Plant details",
  title: "Plant Details",
} as const;
