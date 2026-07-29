/**
 * The "start the FusionSolar OAuth flow" CTA shown wherever a page needs
 * to guide a plant-less organization toward connecting one (Dashboard,
 * Market, Automations empty states - see EmptyState.tsx). Settings' own
 * Power Plants card has its own copy of this same href for its
 * Connect/Reconnect button (contextual label, already-connected state);
 * this is specifically the plant-less-empty-state CTA, always the same
 * label, reusing the identical destination rather than inventing a
 * second route for the same OAuth flow.
 *
 * Plain <a>, not next/link's <Link>, is intentional: this starts a real
 * OAuth redirect, and Link's prefetching would trigger that flow before
 * the user actually clicks - same reasoning as Settings' own connect
 * button.
 */
export function ConnectFusionSolarButton() {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a
      href="/api/auth/fusionsolar/connect"
      className="inline-block rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
    >
      Connect Plant
    </a>
  );
}
